import { Inject, Injectable, OnModuleInit, OnModuleDestroy, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STOCK_ALIASES, type CrawlerResult, type StockAlert, type StockSymbol } from '@tradeping/types';
import { Observable, Subject } from 'rxjs';
import { LogsService } from '../logs/logs.service';
import { AlertsService } from '../alerts/alerts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { mockPrice } from './mock-prices';

const SHARESANSAR_URL = 'https://www.sharesansar.com/today-share-price';
const SHARESANSAR_SECTOR_URL = 'https://www.sharesansar.com/sectorwise-share-price';
const SECTOR_CACHE_TTL_MS = 60 * 60_000;

interface PriceEntry {
  price: number;
  prevClose: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  sector?: string;
  source: 'LIVE' | 'MOCK';
  ts: number;
}

export interface PriceSummary {
  symbol: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  sector: string;
  source: 'LIVE' | 'MOCK';
  timestamp: string;
}

export type CrawlStepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error';

export interface CrawlStep {
  id: string;
  label: string;
  source?: string;
  url?: string;
  status: CrawlStepStatus;
  detail: string;
  durationMs?: number;
}

export interface CrawlNotice {
  source: string;
  title: string;
  url?: string;
  snippet: string;
  matchedSymbols: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface StockPrediction {
  symbol: string;
  verdict: 'BULLISH' | 'WATCH' | 'NEUTRAL' | 'RISK';
  confidence: number;
  score: number;
  price?: number;
  changePct?: number;
  volume?: number;
  turnover?: number;
  sector?: string;
  notices: CrawlNotice[];
  reasons: string[];
}

export interface CrawlPredictionReport {
  requestedSymbols: string[];
  generatedAt: string;
  steps: CrawlStep[];
  predictions: StockPrediction[];
  summary: string;
  mode?: 'single' | 'comparison' | 'batch';
  winner?: string;
  sources: CrawlSourceConfig[];
  sourceReports: CrawlSourceReport[];
}

export interface CrawlSourceConfig {
  id: string;
  label: string;
  source: string;
  url: string;
  custom?: boolean;
}

export interface CrawlSourceReport {
  id: string;
  source: string;
  url: string;
  status: CrawlStepStatus;
  noticesFound: number;
  bytesRead: number;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface CustomCrawlSource {
  label?: string;
  url: string;
}

@Injectable()
export class CrawlerService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private lastCheckAt: string | null = null;
  private lastCheckOk = true;
  /** Minimum time between actual HTTP fetches to ShareSansar */
  private pageCacheTtlMs = 30_000;
  /** HTTP request timeout (ms) */
  private crawlerTimeoutMs = 15_000;
  /** Retry attempts on failed fetch */
  private crawlerRetryCount = 2;
  /** Skip evaluation outside NEPSE hours when true */
  private marketHoursOnly = false;
  /** Fall back to mock prices when live fetch fails */
  private crawlerMockOnFetchFail = true;
  /** User-Agent header sent to ShareSansar */
  private crawlerUserAgent = 'Mozilla/5.0 (compatible; TradePing/1.0)';
  /** Max symbols evaluated per auto-tick (0 = all) */
  private crawlerMaxSymbolsPerTick = 0;

  /** Per-symbol price cache — populated by prefetch and each alert check */
  private priceCache = new Map<string, PriceEntry>();
  /** Raw HTML page cache — avoids hammering ShareSansar */
  private pageCache: { html: string; ts: number } | null = null;
  /** Symbol → sector cache from ShareSansar's sectorwise page. */
  private sectorCache: { sectors: Map<string, string>; ts: number } | null = null;

  /** Pushes the full price snapshot to SSE subscribers after every tick. */
  private readonly priceStream$ = new Subject<PriceSummary[]>();
  /** Last persisted timestamp per symbol — to throttle PriceHistory inserts. */
  private lastPersistedAt = new Map<string, number>();
  /** Minimum gap between persisted samples per symbol. */
  private readonly historySampleIntervalMs = 60_000;

  // Debugging Progress State
  private currentProgress = { step: 'IDLE', message: '', processed: 0, total: 0, currentSymbol: '' };

  constructor(
    private readonly config: ConfigService,
    private readonly logs: LogsService,
    @Inject(forwardRef(() => AlertsService))
    private readonly alerts: AlertsService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Returns an observable that emits the latest snapshot on each crawler tick. */
  subscribePrices(): Observable<PriceSummary[]> {
    return this.priceStream$.asObservable();
  }

  async getHistory(symbol: string, range: '1d' | '5d' | '1mo'): Promise<{ timestamp: string; price: number }[]> {
    const normalized = (STOCK_ALIASES[symbol] ?? symbol).toUpperCase();
    const since = new Date();
    if (range === '1d') since.setHours(since.getHours() - 24);
    else if (range === '5d') since.setDate(since.getDate() - 5);
    else since.setMonth(since.getMonth() - 1);

    const rows = await this.prisma.priceHistory.findMany({
      where: { symbol: normalized, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, price: true },
    });
    return rows.map((r) => ({ timestamp: r.timestamp.toISOString(), price: r.price }));
  }

  async analyzeSingleStock(
    rawSymbol: string,
    sourceIds?: string[],
    customSources?: CustomCrawlSource[],
  ): Promise<CrawlPredictionReport> {
    const symbol = this.normalizeSymbols([rawSymbol])[0];
    return this.analyzeStocks(symbol ? [symbol] : [], 'single', sourceIds, customSources);
  }

  async compareStocks(
    rawSymbols: string[],
    sourceIds?: string[],
    customSources?: CustomCrawlSource[],
  ): Promise<CrawlPredictionReport> {
    const symbols = this.normalizeSymbols(rawSymbols).slice(0, 8);
    const steps: CrawlStep[] = [];
    const predictions: StockPrediction[] = [];
    const sourceReports: CrawlSourceReport[] = [];
    const selectedSources = this.selectSourceConfigs(symbols[0], sourceIds, customSources);

    for (const [index, symbol] of symbols.entries()) {
      const startedAt = Date.now();
      const step: CrawlStep = {
        id: `compare-${symbol}`,
        label: `Crawl ${symbol}`,
        status: 'running',
        detail: `Analyzing stock ${index + 1} of ${symbols.length}.`,
      };
      steps.push(step);

      const report = await this.analyzeStocks([symbol], 'single', sourceIds, customSources);
      predictions.push(...report.predictions);
      sourceReports.push(...report.sourceReports);
      steps.push(...report.steps.map((item) => ({ ...item, id: `${symbol}-${item.id}`, label: `${symbol}: ${item.label}` })));
      step.status = 'done';
      step.detail = `${symbol} crawl completed.`;
      step.durationMs = Date.now() - startedAt;
    }

    const ranked = predictions.sort((a, b) => b.score - a.score);
    const winner = ranked[0]?.symbol;
    const summary = winner
      ? `${winner} ranks strongest across the comparison with a score of ${ranked[0].score}.`
      : 'No symbols were available for comparison.';

    this.logs.info(`Crawler comparison completed for ${symbols.join(', ') || 'no symbols'}`);

    return {
      requestedSymbols: symbols,
      generatedAt: new Date().toISOString(),
      steps,
      predictions: ranked,
      summary,
      mode: 'comparison',
      winner,
      sources: selectedSources,
      sourceReports,
    };
  }

  async analyzeStocks(
    rawSymbols: string[],
    mode: 'single' | 'comparison' | 'batch' = 'batch',
    sourceIds?: string[],
    customSources?: CustomCrawlSource[],
  ): Promise<CrawlPredictionReport> {
    const symbols = this.normalizeSymbols(rawSymbols).slice(0, 12);

    const steps: CrawlStep[] = [];
    const completeStep = (step: CrawlStep, status: CrawlStepStatus, detail: string, startedAt: number) => {
      step.status = status;
      step.detail = detail;
      step.durationMs = Date.now() - startedAt;
    };

    const normalizeStarted = Date.now();
    const normalizeStep: CrawlStep = {
      id: 'normalize-symbols',
      label: 'Normalize symbols',
      status: 'running',
      detail: 'Cleaning aliases and removing duplicate stock symbols.',
    };
    steps.push(normalizeStep);
    completeStep(normalizeStep, symbols.length ? 'done' : 'warning', `${symbols.length} symbol${symbols.length === 1 ? '' : 's'} queued.`, normalizeStarted);

    const priceStarted = Date.now();
    const priceStep: CrawlStep = {
      id: 'market-snapshot',
      label: 'Read live market snapshot',
      source: 'ShareSansar',
      url: SHARESANSAR_URL,
      status: 'running',
      detail: 'Reading latest price, change, volume, and turnover from the crawler cache.',
    };
    steps.push(priceStep);
    if (this.priceCache.size === 0) {
      await this.prefetch();
    }
    const prices = this.getLatestPrices();
    completeStep(priceStep, prices.length ? 'done' : 'warning', `${prices.length} live price rows available.`, priceStarted);

    const sourceConfigs = this.selectSourceConfigs(symbols[0], sourceIds, customSources);
    const sourceReports: CrawlSourceReport[] = [];
    this.logs.info(
      `Prediction crawl started for ${symbols.join(', ') || 'no symbols'} using ${sourceConfigs.length} source${sourceConfigs.length === 1 ? '' : 's'}`,
    );

    const crawled = await Promise.all(
      sourceConfigs.map(async (source) => {
        const startedAt = Date.now();
        const step: CrawlStep = {
          id: source.id,
          label: source.label,
          source: source.source,
          url: source.url,
          status: 'running',
          detail: `Scanning ${source.source} for related notices.`,
        };
        steps.push(step);
        try {
          this.logs.info(`Prediction crawl source started: ${source.source} (${source.url})`);
          const fetchResult = await this.fetchTextWithRetry(source.url, 12_000, 2);
          const html = fetchResult.text;
          const notices = this.extractRelatedNotices(html, source.source, source.url, symbols);
          completeStep(
            step,
            notices.length ? 'done' : 'warning',
            notices.length
              ? `${notices.length} related notice${notices.length === 1 ? '' : 's'} found after ${fetchResult.attempts} attempt${fetchResult.attempts === 1 ? '' : 's'}.`
              : `Crawled ${fetchResult.bytesRead.toLocaleString('en-US')} bytes after ${fetchResult.attempts} attempt${fetchResult.attempts === 1 ? '' : 's'}, but no symbol-specific notice was found.`,
            startedAt,
          );
          sourceReports.push({
            id: source.id,
            source: source.source,
            url: source.url,
            status: notices.length ? 'done' : 'warning',
            noticesFound: notices.length,
            bytesRead: fetchResult.bytesRead,
            attempts: fetchResult.attempts,
            durationMs: Date.now() - startedAt,
          });
          this.logs.info(`Prediction crawl source completed: ${source.source} (${notices.length} notices)`);
          return notices;
        } catch (err) {
          const message = (err as Error).message || 'Source crawl failed.';
          completeStep(step, 'error', `${message}. Retried and skipped this source.`, startedAt);
          sourceReports.push({
            id: source.id,
            source: source.source,
            url: source.url,
            status: 'error',
            noticesFound: 0,
            bytesRead: 0,
            attempts: 3,
            durationMs: Date.now() - startedAt,
            error: message,
          });
          this.logs.warn(`Prediction crawl source failed after retries: ${source.source} (${message})`);
          return [] as CrawlNotice[];
        }
      }),
    );

    const notices = crawled.flat();
    const scoreStarted = Date.now();
    const scoreStep: CrawlStep = {
      id: 'score-predictions',
      label: 'Score predictions',
      status: 'running',
      detail: 'Combining price momentum, liquidity, and notice sentiment.',
    };
    steps.push(scoreStep);
    const predictions = symbols.map((symbol) => this.predictSymbol(symbol, prices, notices));
    completeStep(scoreStep, 'done', `Generated ${predictions.length} prediction${predictions.length === 1 ? '' : 's'}.`, scoreStarted);

    const strongest = [...predictions].sort((a, b) => b.score - a.score)[0];
    const summary = strongest
      ? `${strongest.symbol} has the strongest current setup (${strongest.verdict}, ${strongest.confidence}% confidence).`
      : 'No symbols were available for prediction.';

    this.logs.info(`Crawler prediction completed for ${symbols.join(', ') || 'no symbols'}`);

    return {
      requestedSymbols: symbols,
      generatedAt: new Date().toISOString(),
      steps,
      predictions,
      summary,
      mode,
      winner: strongest?.symbol,
      sources: sourceConfigs,
      sourceReports,
    };
  }

  private normalizeSymbols(rawSymbols: string[]): string[] {
    return Array.from(
      new Set(
        rawSymbols
          .map((symbol) => (STOCK_ALIASES[symbol] ?? symbol).replace(/[^A-Za-z0-9]/g, '').toUpperCase())
          .filter(Boolean),
      ),
    );
  }

  private selectSourceConfigs(
    symbol?: string,
    sourceIds?: string[],
    customSources?: CustomCrawlSource[],
  ): CrawlSourceConfig[] {
    const configs = [...this.stockSourceConfigs(symbol), ...this.customSourceConfigs(customSources)];
    const selected = new Set((sourceIds ?? []).filter(Boolean));
    const filtered = selected.size ? configs.filter((source) => selected.has(source.id)) : configs;
    return filtered.length ? filtered : configs;
  }

  private customSourceConfigs(customSources?: CustomCrawlSource[]): CrawlSourceConfig[] {
    const configs: CrawlSourceConfig[] = [];
    for (const source of (customSources ?? []).slice(0, 6)) {
      try {
        const url = new URL(source.url.trim());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
        const host = url.hostname.replace(/^www\./, '');
        configs.push({
          id: `custom-${host.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`,
          label: source.label?.trim() || `Crawl ${host}`,
          source: source.label?.trim() || host,
          url: url.toString(),
          custom: true,
        });
      } catch {
        continue;
      }
    }
    return configs;
  }

  private stockSourceConfigs(symbol?: string): CrawlSourceConfig[] {
    const query = encodeURIComponent(symbol ?? 'nepse');
    return [
      {
        id: 'sharesansar-announcements',
        label: 'Crawl ShareSansar announcements',
        source: 'ShareSansar',
        url: 'https://www.sharesansar.com/category/announcement',
      },
      {
        id: 'sharesansar-news',
        label: 'Crawl ShareSansar news',
        source: 'ShareSansar',
        url: 'https://www.sharesansar.com/category/latest',
      },
      {
        id: 'merolagani-news',
        label: 'Crawl MeroLagani market news',
        source: 'MeroLagani',
        url: 'https://merolagani.com/NewsList.aspx',
      },
      {
        id: 'nepse-notices',
        label: 'Crawl NEPSE notices',
        source: 'NEPSE',
        url: 'https://www.nepalstock.com.np/news',
      },
      {
        id: 'nepalipaisa-news',
        label: 'Crawl Nepali Paisa news',
        source: 'Nepali Paisa',
        url: `https://www.nepalipaisa.com/News?search=${query}`,
      },
      {
        id: 'chukul-news',
        label: 'Crawl Chukul market feed',
        source: 'Chukul',
        url: `https://chukul.com/news?search=${query}`,
      },
    ];
  }

  private async fetchTextWithRetry(
    url: string,
    timeoutMs: number,
    retries: number,
  ): Promise<{ text: string; attempts: number; bytesRead: number }> {
    let lastErr: Error = new Error('No fetch attempt made');
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            'User-Agent': this.crawlerUserAgent,
            Accept: 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`${new URL(url).hostname} responded with HTTP ${res.status}`);
        const text = await res.text();
        return { text, attempts: attempt, bytesRead: text.length };
      } catch (err) {
        lastErr = err as Error;
        if (attempt <= retries) {
          this.logs.warn(`Prediction crawl retry ${attempt}/${retries} for ${url}: ${lastErr.message}`);
          await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
        }
      }
    }
    throw lastErr;
  }

  private extractRelatedNotices(html: string, source: string, baseUrl: string, symbols: string[]): CrawlNotice[] {
    const notices: CrawlNotice[] = [];
    const seen = new Set<string>();
    const anchorRx = /<a\b[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = anchorRx.exec(html)) !== null && notices.length < 32) {
      const title = this.htmlText(match[2]).replace(/\s+/g, ' ').trim();
      if (title.length < 12 || title.length > 220) continue;

      const upper = title.toUpperCase();
      const matchedSymbols = symbols.filter((symbol) => new RegExp(`(^|[^A-Z0-9])${symbol}([^A-Z0-9]|$)`).test(upper));
      const marketRelated =
        matchedSymbols.length > 0 ||
        /\b(dividend|bonus|right share|auction|book closure|agm|earning|profit|loss|merger|listed|notice|ipo|fpo|financial|quarter)\b/i.test(
          title,
        );
      if (!marketRelated) continue;

      const key = `${source}:${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const href = match[1] ?? '';
      let url: string | undefined;
      try {
        url = new URL(href, baseUrl).toString();
      } catch {
        url = undefined;
      }

      notices.push({
        source,
        title,
        url,
        snippet: title,
        matchedSymbols,
        sentiment: this.classifyNoticeSentiment(title),
      });
    }

    return notices;
  }

  private classifyNoticeSentiment(text: string): CrawlNotice['sentiment'] {
    const value = text.toLowerCase();
    if (/\b(loss|decrease|decline|falls?|suspend|penalty|fine|negative|risk|warning|book closure)\b/.test(value)) {
      return 'negative';
    }
    if (/\b(profit|increase|growth|bonus|dividend|right share|approved|listed|allotment|merger|gain|positive)\b/.test(value)) {
      return 'positive';
    }
    return 'neutral';
  }

  private predictSymbol(symbol: string, prices: PriceSummary[], notices: CrawlNotice[]): StockPrediction {
    const price = prices.find((item) => item.symbol === symbol);
    const relatedNotices = notices
      .filter((notice) => notice.matchedSymbols.includes(symbol) || notice.matchedSymbols.length === 0)
      .slice(0, 6);
    const sentimentScore = relatedNotices.reduce((sum, notice) => {
      if (notice.sentiment === 'positive') return sum + 10;
      if (notice.sentiment === 'negative') return sum - 12;
      return sum;
    }, 0);
    const momentumScore = price ? Math.max(-35, Math.min(35, price.changePct * 4)) : 0;
    const liquidityScore = price?.volume ? Math.min(15, Math.log10(Math.max(price.volume, 1)) * 3) : 0;
    const score = Math.round(Math.max(-100, Math.min(100, momentumScore + sentimentScore + liquidityScore)));
    const sourceCount = new Set(relatedNotices.map((notice) => notice.source)).size;
    const confidence = Math.round(Math.max(35, Math.min(92, 45 + sourceCount * 10 + relatedNotices.length * 3 + (price ? 12 : 0))));
    const verdict: StockPrediction['verdict'] =
      score >= 35 ? 'BULLISH' : score >= 12 ? 'WATCH' : score <= -18 ? 'RISK' : 'NEUTRAL';
    const reasons = [
      price ? `${price.changePct >= 0 ? 'Positive' : 'Negative'} intraday move of ${price.changePct.toFixed(2)}%.` : 'No live price row found in the crawler cache.',
      relatedNotices.length
        ? `${relatedNotices.length} related market notice${relatedNotices.length === 1 ? '' : 's'} influenced the score.`
        : 'No symbol-specific notice was found across crawled sources.',
      price?.volume ? `Volume read: ${Math.round(price.volume).toLocaleString('en-US')}.` : 'Volume signal unavailable.',
    ];

    return {
      symbol,
      verdict,
      confidence,
      score,
      price: price?.price,
      changePct: price?.changePct,
      volume: price?.volume,
      turnover: price?.turnover,
      sector: price?.sector,
      notices: relatedNotices,
      reasons,
    };
  }

  private async persistSnapshot() {
    const now = Date.now();
    const rows: { symbol: string; price: number; source: string; timestamp: Date }[] = [];
    for (const [symbol, entry] of this.priceCache) {
      const last = this.lastPersistedAt.get(symbol) ?? 0;
      if (now - last < this.historySampleIntervalMs) continue;
      rows.push({ symbol, price: entry.price, source: entry.source, timestamp: new Date(entry.ts) });
      this.lastPersistedAt.set(symbol, now);
    }
    if (rows.length === 0) return;
    try {
      await this.prisma.priceHistory.createMany({ data: rows });
    } catch (err) {
      this.logs.warn(`PriceHistory persist failed: ${(err as Error).message}`);
    }
  }

  async onModuleInit() {
    this.logs.info('Crawler started — data source: ShareSansar (sharesansar.com)');
    const seconds = Number(this.config.get('CRAWLER_INTERVAL_SECONDS') ?? 5);
    this.pageCacheTtlMs = Number(this.config.get('PAGE_CACHE_TTL_SECONDS') ?? 30) * 1000;
    this.crawlerTimeoutMs = Number(this.config.get('CRAWLER_TIMEOUT_SECONDS') ?? 15) * 1000;
    this.crawlerRetryCount = Number(this.config.get('CRAWLER_RETRY_COUNT') ?? 2);
    this.marketHoursOnly = this.config.get('MARKET_HOURS_ONLY') === 'true';
    this.crawlerMockOnFetchFail = this.config.get('CRAWLER_MOCK_ON_FETCH_FAIL') !== 'false';
    this.crawlerUserAgent = this.config.get('CRAWLER_USER_AGENT') ?? 'Mozilla/5.0 (compatible; TradePing/1.0)';
    this.crawlerMaxSymbolsPerTick = Number(this.config.get('CRAWLER_MAX_SYMBOLS_PER_TICK') ?? 0);
    this.intervalHandle = setInterval(() => void this.runAutoCheck(), seconds * 1000);
    // Eagerly warm up price cache if configured
    if (this.config.get('CRAWLER_PREFETCH_ON_START') !== 'false') {
      void this.prefetch();
    }
  }

  async onModuleDestroy() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  getStatus() {
    return { lastCheckAt: this.lastCheckAt, lastCheckOk: this.lastCheckOk };
  }

  /** Applies new settings at runtime — called by SettingsController. */
  applySettings({
    intervalSeconds,
    pageCacheTtlMs,
    timeoutMs,
    retryCount,
    marketHoursOnly,
    maxSymbolsPerTick,
    userAgent,
    mockOnFetchFail,
  }: {
    intervalSeconds?: number;
    pageCacheTtlMs?: number;
    timeoutMs?: number;
    retryCount?: number;
    marketHoursOnly?: boolean;
    maxSymbolsPerTick?: number;
    userAgent?: string;
    mockOnFetchFail?: boolean;
  }) {
    if (pageCacheTtlMs !== undefined) this.pageCacheTtlMs = pageCacheTtlMs;
    if (timeoutMs !== undefined) this.crawlerTimeoutMs = timeoutMs;
    if (retryCount !== undefined) this.crawlerRetryCount = retryCount;
    if (userAgent !== undefined) this.crawlerUserAgent = userAgent;
    if (mockOnFetchFail !== undefined) this.crawlerMockOnFetchFail = mockOnFetchFail;
    if (marketHoursOnly !== undefined) {
      this.marketHoursOnly = marketHoursOnly;
      this.logs.info(`Market-hours-only mode ${marketHoursOnly ? 'enabled' : 'disabled'}`);
    }
    if (maxSymbolsPerTick !== undefined) this.crawlerMaxSymbolsPerTick = maxSymbolsPerTick;
    if (intervalSeconds !== undefined) {
      if (this.intervalHandle) clearInterval(this.intervalHandle);
      this.intervalHandle = setInterval(() => void this.runAutoCheck(), intervalSeconds * 1000);
      this.logs.info(`Crawler interval updated to ${intervalSeconds}s`);
    }
  }

  /** Returns true when current UTC time falls within NEPSE trading hours (Sun–Thu 11:00–15:00 NPT, UTC+5:45). */
  private isNepseHours(): boolean {
    const now = new Date();
    // NPT = UTC + 5h 45m
    const nptOffsetMs = (5 * 60 + 45) * 60_000;
    const nptDate = new Date(now.getTime() + nptOffsetMs);
    const day = nptDate.getUTCDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
    if (day === 5 || day === 6) return false; // Fri-Sat are NEPSE holidays
    const h = nptDate.getUTCHours();
    const m = nptDate.getUTCMinutes();
    const minutes = h * 60 + m;
    return minutes >= 11 * 60 && minutes < 15 * 60; // 11:00–15:00 NPT
  }

  getAvailableSymbols(): string[] {
    return Array.from(this.priceCache.keys()).sort((a, b) => a.localeCompare(b));
  }

  /** Returns the latest known price for every symbol that has been fetched. */
  getLatestPrices(): PriceSummary[] {
    return Array.from(this.priceCache.entries()).map(([symbol, v]) => ({
      symbol,
      price: v.price,
      prevClose: v.prevClose,
      change: Math.round((v.price - v.prevClose) * 100) / 100,
      changePct:
        v.prevClose > 0
          ? Math.round(((v.price - v.prevClose) / v.prevClose) * 10000) / 100
          : 0,
      high: v.high,
      low: v.low,
      volume: v.volume,
      turnover: v.turnover,
      sector: v.sector ?? 'Others',
      source: v.source,
      timestamp: new Date(v.ts).toISOString(),
    }));
  }

  async refreshPrices() {
    this.pageCache = null;
    await this.prefetch();
    const snapshot = this.getLatestPrices();
    void this.persistSnapshot();
    this.priceStream$.next(snapshot);
    return snapshot;
  }

  // Exposes internal data for the Debugger UI
  getDebugState() {
    return {
      running: this.running,
      status: this.getStatus(),
      cacheSize: this.priceCache.size,
      pageCacheReady: !!this.pageCache,
      lastCheckAt: this.lastCheckAt,
      lastCheckOk: this.lastCheckOk,
      marketHoursMode: this.marketHoursOnly,
      progress: this.currentProgress || null,
    };
  }

  clearCache() {
    this.priceCache.clear();
    this.pageCache = null;
    this.logs.warn('System cache forcibly cleared by user');
  }

  // ---

  async runManualCheck() {
    const result = await this.checkAllAlerts();
    this.logs.info('Manual check completed');
    return result;
  }

  private async prefetch() {
    try {
      const prices = await this.loadPageCache();
      const sectors = await this.loadSectorMapBestEffort();
      // Pre-populate cache with all symbols returned by ShareSansar
      for (const [sym, entry] of prices) {
        this.priceCache.set(sym, {
          ...entry,
          sector: this.resolveSector(sym, sectors, entry.sector),
          source: 'LIVE',
          ts: Date.now(),
        });
      }
      this.logs.info(`Prefetched ${prices.size} NEPSE prices from ShareSansar`);
    } catch (err) {
      this.logs.warn(`Prefetch failed: ${(err as Error).message}`);
    }
  }

  /**
   * Runs on every tick of the crawler interval (default: every 5 s).
   * Strategy:
   *  1. Load the ShareSansar page (from cache if < 30 s old, else live HTTP).
   *  2. Populate priceCache for EVERY symbol returned — so all stocks stay fresh.
   *  3. Evaluate every active alert against the now-current cache.
   */
  private async runAutoCheck() {
    if (this.running) return;
    // Skip tick when market-hours-only mode is on and exchange is closed
    if (this.marketHoursOnly && !this.isNepseHours()) return;
    this.running = true;
    try {
      const prices = await this.loadPageCache();
      const sectors = await this.loadSectorMapBestEffort();
      const now = Date.now();
      for (const [sym, entry] of prices) {
        this.priceCache.set(sym, {
          ...entry,
          sector: this.resolveSector(sym, sectors, entry.sector),
          source: 'LIVE',
          ts: now,
        });
      }

      let active = await this.alerts.findActive();
      // Apply per-tick symbol cap if configured
      if (this.crawlerMaxSymbolsPerTick > 0) {
        active = active.slice(0, this.crawlerMaxSymbolsPerTick);
      }
      for (const alert of active) {
        const normalizedSymbol = (STOCK_ALIASES[alert.symbol] ?? alert.symbol).toUpperCase();
        const cached = this.priceCache.get(normalizedSymbol);
        if (cached) await this.evaluateAlert(alert, cached.price);
      }
      this.lastCheckOk = true;

      // Persist snapshot (throttled per symbol) and broadcast to SSE subscribers.
      void this.persistSnapshot();
      this.priceStream$.next(this.getLatestPrices());
    } catch (err) {
      this.lastCheckOk = false;
      this.logs.error(`Crawler cycle failed: ${(err as Error).message}`);
    } finally {
      this.lastCheckAt = new Date().toISOString();
      this.running = false;
    }
  }

  private async checkAllAlerts() {
    this.running = true;
    this.currentProgress = { step: 'FETCHING_ACTIVE_ALERTS', message: 'Fetching active alerts from DB...', processed: 0, total: 0, currentSymbol: '' };
    const active = await this.alerts.findActive();
    const checked: CrawlerResult[] = [];
    this.currentProgress.total = active.length;

    try {
      this.currentProgress = { ...this.currentProgress, step: 'FETCHING_CACHE', message: 'Refreshing ShareSansar Page Cache...' };
      // Force a fresh page fetch for manual checks
      this.pageCache = null;
      const prices = await this.loadPageCache();
      const sectors = await this.loadSectorMapBestEffort();
      const now = Date.now();
      for (const [sym, entry] of prices) {
        this.priceCache.set(sym, {
          ...entry,
          sector: this.resolveSector(sym, sectors, entry.sector),
          source: 'LIVE',
          ts: now,
        });
      }

      this.currentProgress.step = 'EVALUATING_ALERTS';
      let i = 0;
      for (const alert of active) {
        i++;
        this.currentProgress = { ...this.currentProgress, processed: i, currentSymbol: alert.symbol, message: `Evaluating ${alert.symbol} (${i}/${active.length})` };
        const result = await this.fetchPrice(alert.symbol);
        checked.push(result);
        await this.evaluateAlert(alert, result.price);
      }
      this.lastCheckOk = true;
    } catch (err) {
      this.lastCheckOk = false;
      this.logs.error(`Crawler cycle failed: ${(err as Error).message}`);
    } finally {
      this.lastCheckAt = new Date().toISOString();
      this.running = false;
      this.currentProgress.step = 'IDLE';
      this.currentProgress.message = 'Idle...';
    }
    return { checked, count: active.length };
  }

  private async evaluateAlert(alert: StockAlert, price: number) {
    await this.alerts.updateLastChecked(alert.id, price);
    const hit =
      (alert.condition === 'ABOVE' && price > alert.targetPrice) ||
      (alert.condition === 'BELOW' && price < alert.targetPrice) ||
      (alert.condition === 'EQUAL' && Math.abs(price - alert.targetPrice) < 0.01);

    if (hit) {
      await this.alerts.markTriggered(alert.id, price);
      void this.notifications.notifyAlertTriggered(alert, price);
      this.logs.success(`Target reached for ${alert.symbol}`);
    } else {
      this.logs.info(`No alert triggered for ${alert.symbol}`);
    }
  }

  private async fetchPrice(symbol: StockSymbol): Promise<CrawlerResult> {
    const inputSymbol = symbol.toUpperCase();
    const normalizedSymbol = (STOCK_ALIASES[inputSymbol] ?? inputSymbol).toUpperCase();
    this.logs.info(`Fetching price for ${normalizedSymbol}`);

    // Use cached value if still fresh
    const cached = this.priceCache.get(normalizedSymbol);
    if (cached && Date.now() - cached.ts < this.pageCacheTtlMs && cached.source === 'LIVE') {
      this.logs.info(`Current price for ${normalizedSymbol} is Rs. ${cached.price} (cache hit)`);
      return { symbol: normalizedSymbol, price: cached.price, source: 'LIVE', timestamp: new Date().toISOString() };
    }

    try {
      const prices = await this.loadPageCache();
      const entry = prices.get(normalizedSymbol.toUpperCase());
      if (!entry || entry.price <= 0) throw new Error(`Symbol ${normalizedSymbol} not found in today's data`);

      const sectors = await this.loadSectorMapBestEffort();
      this.priceCache.set(normalizedSymbol, {
        ...entry,
        sector: this.resolveSector(normalizedSymbol, sectors, entry.sector),
        source: 'LIVE',
        ts: Date.now(),
      });
      this.logs.success(`Current price for ${normalizedSymbol} is Rs. ${entry.price}`);
      return { symbol: normalizedSymbol, price: entry.price, source: 'LIVE', timestamp: new Date().toISOString() };
    } catch (err) {
      if (!this.crawlerMockOnFetchFail) {
        this.logs.error(`Live fetch failed for ${normalizedSymbol}: ${(err as Error).message}`);
        throw err;
      }
      this.logs.warn(`Live fetch failed for ${normalizedSymbol}: ${(err as Error).message}, using mock`);
      const price = mockPrice(normalizedSymbol);
      const existing = this.priceCache.get(normalizedSymbol);
      this.priceCache.set(normalizedSymbol, {
        price,
        prevClose: existing?.prevClose ?? price,
        high: price,
        low: price,
        volume: existing?.volume ?? 0,
        turnover: existing?.turnover ?? 0,
        sector: existing?.sector ?? 'Others',
        source: 'MOCK',
        ts: Date.now(),
      });
      this.logs.info(`Current price for ${normalizedSymbol} is Rs. ${price} (mock)`);
      return { symbol: normalizedSymbol, price, source: 'MOCK', timestamp: new Date().toISOString() };
    }
  }

  /**
   * Fetches and caches the ShareSansar today-share-price HTML page, then
   * parses it into a symbol → price-data map.
   */
  private async loadPageCache(): Promise<Map<string, Omit<PriceEntry, 'source' | 'ts'>>> {
    const now = Date.now();
    if (this.pageCache && now - this.pageCache.ts < this.pageCacheTtlMs) {
      return this.parseHtml(this.pageCache.html);
    }

    this.logs.info('Fetching latest prices from ShareSansar…');
    let lastErr: Error = new Error('No attempts made');
    for (let attempt = 0; attempt <= this.crawlerRetryCount; attempt++) {
      try {
        const res = await fetch(SHARESANSAR_URL, {
          headers: {
            'User-Agent': this.crawlerUserAgent,
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(this.crawlerTimeoutMs),
        });
        if (!res.ok) throw new Error(`ShareSansar returned HTTP ${res.status}`);
        const html = await res.text();
        this.pageCache = { html, ts: now };
        return this.parseHtml(html);
      } catch (err) {
        lastErr = err as Error;
        if (attempt < this.crawlerRetryCount) {
          this.logs.warn(`Fetch attempt ${attempt + 1} failed (${lastErr.message}), retrying…`);
        }
      }
    }
    throw lastErr;
  }

  private async loadSectorMapBestEffort(): Promise<Map<string, string>> {
    try {
      return await this.loadSectorMapCache();
    } catch (err) {
      this.logs.warn(`Sector map refresh failed: ${(err as Error).message}`);
      return this.sectorCache?.sectors ?? new Map<string, string>();
    }
  }

  private async loadSectorMapCache(): Promise<Map<string, string>> {
    const now = Date.now();
    if (this.sectorCache && now - this.sectorCache.ts < SECTOR_CACHE_TTL_MS) {
      return this.sectorCache.sectors;
    }

    const res = await fetch(SHARESANSAR_SECTOR_URL, {
      headers: {
        'User-Agent': this.crawlerUserAgent,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(this.crawlerTimeoutMs),
    });
    if (!res.ok) throw new Error(`ShareSansar sector page returned HTTP ${res.status}`);
    const html = await res.text();
    const sectors = this.parseSectorHtml(html);
    if (sectors.size === 0) throw new Error('No sectors found in ShareSansar sector page');
    this.sectorCache = { sectors, ts: now };
    return sectors;
  }

  private resolveSector(symbol: string, sectors: Map<string, string>, fallback?: string): string {
    return sectors.get(symbol.toUpperCase()) ?? fallback ?? this.priceCache.get(symbol.toUpperCase())?.sector ?? 'Others';
  }

  /**
   * Parses the ShareSansar today-share-price HTML table.
   *
   * Table columns (0-indexed):
   *   0=S.No  1=Symbol  2=Conf.  3=Open  4=High  5=Low  6=Close  7=LTP
   *   8=Close-LTP  9=Close-LTP%  10=VWAP  11=Vol  12=Prev.Close  13=Turnover …
   */
  private parseHtml(html: string): Map<string, Omit<PriceEntry, 'source' | 'ts'>> {
    const result = new Map<string, Omit<PriceEntry, 'source' | 'ts'>>();
    const inferredSectors = this.parseCompanySectors(html);

    // Split on opening <tr> tags so each chunk is one row's content
    const rows = html.split(/<tr[\s>]/i);
    for (const row of rows) {
      const cells: string[] = [];
      const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let m: RegExpExecArray | null;
      while ((m = tdRx.exec(row)) !== null) {
        cells.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim());
      }

      // Rows with fewer than 13 cells are header/footer — skip
      if (cells.length < 13) continue;

      const symbol = (cells[1] ?? '').replace(/\s+/g, '').toUpperCase();
      if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) continue;

      const num = (s: string | undefined) => parseFloat((s ?? '').replace(/,/g, ''));
      const ltp = num(cells[7]);
      if (isNaN(ltp) || ltp <= 0) continue;

      const prevClose = num(cells[12]);
      result.set(symbol, {
        price: ltp,
        prevClose: isNaN(prevClose) || prevClose <= 0 ? ltp : prevClose,
        high: num(cells[4]) || ltp,
        low: num(cells[5]) || ltp,
        volume: num(cells[11]) || 0,
        turnover: num(cells[13]) || 0,
        sector: inferredSectors.get(symbol),
      });
    }

    return result;
  }

  private parseCompanySectors(html: string): Map<string, string> {
    const result = new Map<string, string>();
    const match = html.match(/var\s+cmpjson\s*=\s*(\[[\s\S]*?\]);/);
    if (!match) return result;

    try {
      const companies = JSON.parse(match[1]) as { symbol?: string; companyname?: string }[];
      for (const company of companies) {
        const symbol = company.symbol?.replace(/\s+/g, '').toUpperCase();
        if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) continue;

        const sector = this.inferSectorFromCompanyName(company.companyname ?? '');
        if (sector) result.set(symbol, sector);
      }
    } catch {
      return result;
    }

    return result;
  }

  private inferSectorFromCompanyName(companyName: string): string | null {
    const name = companyName.toLowerCase();

    if (/debenture|rinpatra|bond/.test(name)) return 'Corporate Debentures';
    if (/mutual fund|fund|yojana|scheme|kosh/.test(name)) return 'Mutual Funds';
    if (/laghubitta|laghu bitta|microfinance/.test(name)) return 'Microfinance';
    if (/life insurance/.test(name)) return 'Life Insurance';
    if (/insurance|reinsurance|micro insurance/.test(name)) return 'Non-Life Insurance';
    if (/development bank|bikas bank|bikash bank/.test(name)) return 'Development Banks';
    if (/\bbank\b|standard chartered|agricultural development bank/.test(name)) return 'Commercial Banks';
    if (/hydro|power|urja|jalbidhyut|bidhyut|electric/.test(name)) return 'Hydropower';
    if (/hotel|resort|tourism|hospitality|cable car|regency|soaltee|yak & yeti/.test(name)) {
      return 'Hotels & Tourism';
    }
    if (/trading|traders|trade tower/.test(name)) return 'Trading';
    if (/finance|merchant banking/.test(name)) return 'Finance';
    if (/capital|investment|securities|stock broker|holdings?|trust/.test(name)) return 'Investment';
    if (
      /cement|manufactur|bottlers|unilever|steel|oil|minerals|processing|pharmaceutical|concreto|spinning|sugar|vanaspati|shoe|pulp|paper/.test(
        name,
      )
    ) {
      return 'Manufacturing & Processing';
    }

    return null;
  }

  private parseSectorHtml(html: string): Map<string, string> {
    const result = new Map<string, string>();
    const sectionRx =
      /<h3[^>]*class=["'][^"']*heading-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3[^>]*class=["'][^"']*heading-title|$)/gi;
    let sectionMatch: RegExpExecArray | null;

    while ((sectionMatch = sectionRx.exec(html)) !== null) {
      const sector = this.normalizeSectorName(this.htmlText(sectionMatch[1]));
      const body = sectionMatch[2] ?? '';
      if (!sector) continue;

      const rowRx = /<tr[\s\S]*?<\/tr>/gi;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRx.exec(body)) !== null) {
        const cells: string[] = [];
        const tdRx = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = tdRx.exec(rowMatch[0])) !== null) {
          cells.push(this.htmlText(cellMatch[1]));
        }

        const symbol = (cells[1] ?? '').replace(/\s+/g, '').toUpperCase();
        if (!symbol || !/^[A-Z0-9]+$/.test(symbol)) continue;
        result.set(symbol, sector);
      }
    }

    return result;
  }

  private htmlText(value: string | undefined): string {
    return (value ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeSectorName(sector: string): string {
    const normalized = sector.trim().replace(/\s+/g, ' ');
    const labels: Record<string, string> = {
      'Commercial Bank': 'Commercial Banks',
      'Development Bank': 'Development Banks',
      'Finance': 'Finance',
      'Hotel & Tourism': 'Hotels & Tourism',
      'Hotels And Tourism': 'Hotels & Tourism',
      'Hydro Power': 'Hydropower',
      'Investment': 'Investment',
      'Life Insurance': 'Life Insurance',
      'Manufacturing And Processing': 'Manufacturing & Processing',
      'Manufacturing and Processing': 'Manufacturing & Processing',
      'Microfinance': 'Microfinance',
      'Mutual Fund': 'Mutual Funds',
      'Non Life Insurance': 'Non-Life Insurance',
      'Others': 'Others',
      'Tradings': 'Trading',
    };
    return labels[normalized] ?? normalized;
  }
}
