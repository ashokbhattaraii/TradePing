import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CrawlerService, type CrawlPredictionReport, type PriceSummary, type PreTradeRiskReport, type StockCommandReport } from '../crawler/crawler.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { LogsService } from '../logs/logs.service';
import { AlertsService } from '../alerts/alerts.service';

export interface PortfolioHoldingDto {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioHoldingAnalysis extends PortfolioHoldingDto {
  name?: string;
  currentPrice: number | null;
  currentValue: number;
  costBasis: number;
  unrealizedGain: number;
  gainPct: number;
  allocationPct: number;
  riskLevel: string;
  riskScore: number;
  decision: string;
  commandStance: string;
  crawlerVerdict: string;
  crawlerConfidence: number;
  crawlerNotices: number;
  crawlerSources: number;
  crawlerSummary: string;
  action: string;
  alertIdeas: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }[];
  evidence: string[];
}

export interface PortfolioAnalysisReport {
  id?: string;
  generatedAt: string;
  reason: 'manual' | 'scheduled';
  status: 'HEALTHY' | 'MONITOR' | 'ATTENTION';
  totalCost: number;
  currentValue: number;
  unrealizedGain: number;
  gainPct: number;
  riskScore: number;
  summary: string;
  holdings: PortfolioHoldingAnalysis[];
  nextRunAt: string | null;
  notifiedAt?: string | null;
}

type HoldingRow = {
  id: string;
  userId: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const WORKER_TICK_MS = 60_000;
const DAILY_CIRCUIT_LIMIT_PCT = 15;
const PORTFOLIO_ANALYSIS_CONCURRENCY = 3;

function toHoldingDto(row: HoldingRow): PortfolioHoldingDto {
  return {
    id: row.id,
    symbol: row.symbol,
    quantity: row.quantity,
    averageCost: row.averageCost,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

@Injectable()
export class PortfolioService implements OnModuleInit, OnModuleDestroy {
  private worker: NodeJS.Timeout | null = null;
  private runningUsers = new Set<string>();
  private holdingChangeTimers = new Map<string, NodeJS.Timeout>();
  private firstAutoRunAfter = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crawler: CrawlerService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly logs: LogsService,
    private readonly alerts: AlertsService,
  ) {}

  onModuleInit() {
    this.worker = setInterval(() => void this.runDueAnalyses(), WORKER_TICK_MS);
    setTimeout(() => void this.runDueAnalyses(), 10_000);
  }

  onModuleDestroy() {
    if (this.worker) clearInterval(this.worker);
    for (const timer of this.holdingChangeTimers.values()) clearTimeout(timer);
    this.holdingChangeTimers.clear();
  }

  async listHoldings(userId: string): Promise<PortfolioHoldingDto[]> {
    const rows = await this.prisma.portfolioHolding.findMany({
      where: { userId },
      orderBy: { symbol: 'asc' },
    });
    return rows.map(toHoldingDto);
  }

  async upsertHolding(
    userId: string,
    body: { symbol: string; quantity: number; averageCost: number; note?: string | null },
  ): Promise<PortfolioHoldingDto> {
    const symbol = this.normalizeSymbol(body.symbol);
    this.assertPositive(body.quantity, 'quantity');
    this.assertPositive(body.averageCost, 'average cost');

    const row = await this.prisma.portfolioHolding.upsert({
      where: { userId_symbol: { userId, symbol } },
      update: {
        quantity: body.quantity,
        averageCost: body.averageCost,
        note: body.note?.trim() || null,
      },
      create: {
        userId,
        symbol,
        quantity: body.quantity,
        averageCost: body.averageCost,
        note: body.note?.trim() || null,
      },
    });
    this.logs.info(`Portfolio holding saved: ${symbol} x ${body.quantity}`);
    void this.queueHoldingChangeAnalysis(userId, `holding saved: ${symbol}`);
    return toHoldingDto(row);
  }

  async updateHolding(
    id: string,
    userId: string,
    body: { quantity?: number; averageCost?: number; note?: string | null },
  ): Promise<PortfolioHoldingDto> {
    const existing = await this.prisma.portfolioHolding.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Portfolio holding ${id} not found`);
    if (body.quantity !== undefined) this.assertPositive(body.quantity, 'quantity');
    if (body.averageCost !== undefined) this.assertPositive(body.averageCost, 'average cost');

    const row = await this.prisma.portfolioHolding.update({
      where: { id },
      data: {
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.averageCost !== undefined ? { averageCost: body.averageCost } : {}),
        ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
      },
    });
    void this.queueHoldingChangeAnalysis(userId, `holding updated: ${existing.symbol}`);
    return toHoldingDto(row);
  }

  async removeHolding(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.portfolioHolding.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Portfolio holding ${id} not found`);
    await this.prisma.portfolioHolding.delete({ where: { id } });
    this.logs.info(`Portfolio holding removed: ${existing.symbol}`);
    void this.queueHoldingChangeAnalysis(userId, `holding removed: ${existing.symbol}`);
    return { id };
  }

  async latestAnalysis(userId: string): Promise<PortfolioAnalysisReport | null> {
    const row = await this.prisma.portfolioAnalysisRun.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.runToReport(row, userId) : null;
  }

  async analysisHistory(userId: string): Promise<PortfolioAnalysisReport[]> {
    const rows = await this.prisma.portfolioAnalysisRun.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return Promise.all(rows.map((row) => this.runToReport(row, userId)));
  }

  async analyze(
    userId: string,
    options: { reason?: 'manual' | 'scheduled'; notify?: boolean } = {},
  ): Promise<PortfolioAnalysisReport> {
    const reason = options.reason ?? 'manual';
    const settings = await this.settings.getForUser(userId);
    const holdings = await this.prisma.portfolioHolding.findMany({
      where: { userId },
      orderBy: { symbol: 'asc' },
    });
    if (holdings.length === 0) {
      throw new BadRequestException('Add at least one portfolio holding before running the bot.');
    }

    let prices = this.crawler.getLatestPrices();
    if (prices.length === 0) {
      prices = await this.crawler.refreshPrices();
    }
    const priceMap = new Map(prices.map((price) => [price.symbol, price]));

    const analyses = await this.mapWithConcurrency(holdings, PORTFOLIO_ANALYSIS_CONCURRENCY, async (holding) => {
      const price = priceMap.get(holding.symbol) ?? null;
      const currentPrice = price?.price ?? holding.averageCost;
      const currentValue = currentPrice * holding.quantity;
      const costBasis = holding.averageCost * holding.quantity;
      const unrealizedGain = currentValue - costBasis;
      const gainPct = costBasis > 0 ? (unrealizedGain / costBasis) * 100 : 0;
      const [risk, command, crawl] = await Promise.all([
        this.safeRisk(holding.symbol, Math.max(currentValue, costBasis), settings.portfolioBotDefaultHoldingDays),
        this.safeCommand(holding.symbol),
        this.safeCrawl(holding.symbol),
      ]);
      return this.buildHoldingAnalysis({
        holding,
        price,
        currentPrice,
        currentValue,
        costBasis,
        unrealizedGain,
        gainPct,
        risk,
        command,
        crawl,
        lossAlertPct: settings.portfolioBotLossAlertPct,
      });
    });

    const totalCost = analyses.reduce((sum, item) => sum + item.costBasis, 0);
    const currentValue = analyses.reduce((sum, item) => sum + item.currentValue, 0);
    const unrealizedGain = currentValue - totalCost;
    const gainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
    const weightedRisk =
      currentValue > 0
        ? analyses.reduce((sum, item) => sum + item.riskScore * item.currentValue, 0) / currentValue
        : analyses.reduce((sum, item) => sum + item.riskScore, 0) / Math.max(1, analyses.length);

    const holdingsWithAllocation = analyses.map((item) => ({
      ...item,
      allocationPct: currentValue > 0 ? round((item.currentValue / currentValue) * 100) : 0,
    }));
    const status = this.statusFor(holdingsWithAllocation, weightedRisk, settings.portfolioBotRiskAlertThreshold, settings.portfolioBotLossAlertPct);
    const summary = this.summaryFor(status, holdingsWithAllocation, gainPct, weightedRisk);

    const run = await this.prisma.portfolioAnalysisRun.create({
      data: {
        userId,
        status,
        reason,
        totalCost: round(totalCost),
        currentValue: round(currentValue),
        unrealizedGain: round(unrealizedGain),
        gainPct: round(gainPct),
        riskScore: round(weightedRisk),
        summary,
        decisions: holdingsWithAllocation,
      },
    });

    let notifiedAt: string | null = null;
    let autoAlertsMaintained = 0;
    if (settings.portfolioBotAutoCreateAlerts) {
      autoAlertsMaintained = await this.syncAutoAlerts(userId, holdingsWithAllocation);
    }

    if (options.notify || reason === 'scheduled') {
      const result = await this.notifications.notifyPortfolioAnalysis(userId, {
        generatedAt: run.createdAt.toISOString(),
        status,
        reason,
        totalCost: round(totalCost),
        currentValue: round(currentValue),
        unrealizedGain: round(unrealizedGain),
        gainPct: round(gainPct),
        riskScore: round(weightedRisk),
        summary,
        holdings: holdingsWithAllocation,
      });
      if (result.ok) {
        const updated = await this.prisma.portfolioAnalysisRun.update({
          where: { id: run.id },
          data: { notifiedAt: new Date() },
        });
        notifiedAt = updated.notifiedAt?.toISOString() ?? null;
      }
    }

    this.logs.info(
      `Portfolio Bot ${reason} analysis completed: ${status} (${holdings.length} holdings, ${autoAlertsMaintained} auto alerts)`,
    );
    return {
      id: run.id,
      generatedAt: run.createdAt.toISOString(),
      reason,
      status,
      totalCost: round(totalCost),
      currentValue: round(currentValue),
      unrealizedGain: round(unrealizedGain),
      gainPct: round(gainPct),
      riskScore: round(weightedRisk),
      summary,
      holdings: holdingsWithAllocation,
      nextRunAt: await this.nextRunAt(userId),
      notifiedAt,
    };
  }

  private async runDueAnalyses() {
    const users = await this.prisma.portfolioHolding.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });
    for (const { userId } of users) {
      if (this.runningUsers.has(userId)) continue;
      this.runningUsers.add(userId);
      try {
        const settings = await this.settings.getForUser(userId);
        if (!settings.portfolioBotEnabled || settings.portfolioBotIntervalMinutes <= 0) continue;
        const firstAutoRunAfter = this.firstAutoRunAfter.get(userId);
        const latest = await this.prisma.portfolioAnalysisRun.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        });
        const dueAt = firstAutoRunAfter ?? (latest
          ? latest.createdAt.getTime() + settings.portfolioBotIntervalMinutes * 60_000
          : Date.now() + 15_000);
        if (Date.now() >= dueAt) {
          await this.analyze(userId, { reason: 'scheduled', notify: true });
          this.firstAutoRunAfter.delete(userId);
        } else if (!latest && !firstAutoRunAfter) {
          this.firstAutoRunAfter.set(userId, dueAt);
        }
      } catch (err) {
        this.logs.warn(`Portfolio Bot scheduled analysis failed: ${(err as Error).message}`);
      } finally {
        this.runningUsers.delete(userId);
      }
    }
  }

  private async queueHoldingChangeAnalysis(userId: string, reason: string): Promise<void> {
    try {
      const settings = await this.settings.getForUser(userId);
      if (!settings.portfolioBotEnabled || !settings.portfolioBotAnalyzeOnHoldingChange) return;

      const existing = this.holdingChangeTimers.get(userId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        this.holdingChangeTimers.delete(userId);
        if (this.runningUsers.has(userId)) return;
        this.runningUsers.add(userId);
        void this.analyze(userId, { reason: 'scheduled', notify: true })
          .then(() => this.logs.info(`Portfolio Bot auto analysis completed after ${reason}`))
          .catch((err) => this.logs.warn(`Portfolio Bot auto analysis failed after ${reason}: ${(err as Error).message}`))
          .finally(() => this.runningUsers.delete(userId));
      }, 5_000);
      this.holdingChangeTimers.set(userId, timer);
      this.logs.info(`Portfolio Bot queued automatic analysis after ${reason}`);
    } catch (err) {
      this.logs.warn(`Portfolio Bot could not queue holding-change analysis: ${(err as Error).message}`);
    }
  }

  private async syncAutoAlerts(userId: string, holdings: PortfolioHoldingAnalysis[]): Promise<number> {
    let maintained = 0;
    for (const holding of holdings) {
      const ideas = ['BELOW', 'ABOVE']
        .map((condition) => holding.alertIdeas.find((idea) => idea.condition === condition))
        .filter((idea): idea is { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string } => Boolean(idea));

      for (const idea of ideas) {
        const targetPrice = this.clampAlertTarget(holding.currentPrice, idea.targetPrice);
        const notePrefix = `Portfolio Bot Auto ${idea.condition}:`;
        const priority = holding.riskScore >= 65 || holding.decision === 'AVOID' ? 'HIGH' : 'MEDIUM';
        const note = `${notePrefix} ${idea.reason}`;
        const existing = await this.prisma.alert.findFirst({
          where: {
            userId,
            symbol: holding.symbol,
            status: 'ACTIVE',
            condition: idea.condition,
            note: { startsWith: notePrefix },
          },
          orderBy: { createdAt: 'desc' },
        });

        if (existing) {
          await this.prisma.alert.update({
            where: { id: existing.id },
            data: {
              targetPrice,
              priority,
              note,
            },
          });
          maintained++;
          continue;
        }

        try {
          await this.alerts.create(
            {
              symbol: holding.symbol,
              condition: idea.condition,
              targetPrice,
              priority,
              note,
            },
            userId,
          );
          maintained++;
        } catch (err) {
          this.logs.warn(`Portfolio Bot auto alert skipped for ${holding.symbol}: ${(err as Error).message}`);
        }
      }
    }
    return maintained;
  }

  private clampAlertTarget(referencePrice: number | null, targetPrice: number): number {
    if (!referencePrice || referencePrice <= 0) return round(targetPrice);
    const lower = referencePrice * (1 - DAILY_CIRCUIT_LIMIT_PCT / 100);
    const upper = referencePrice * (1 + DAILY_CIRCUIT_LIMIT_PCT / 100);
    return round(Math.min(upper, Math.max(lower, targetPrice)), 1);
  }

  private buildHoldingAnalysis(input: {
    holding: HoldingRow;
    price: PriceSummary | null;
    currentPrice: number;
    currentValue: number;
    costBasis: number;
    unrealizedGain: number;
    gainPct: number;
    risk: PreTradeRiskReport | null;
    command: StockCommandReport | null;
    crawl: CrawlPredictionReport | null;
    lossAlertPct: number;
  }): PortfolioHoldingAnalysis {
    const { holding, price, currentPrice, currentValue, costBasis, unrealizedGain, gainPct, risk, command, crawl, lossAlertPct } = input;
    const crawlPrediction = crawl?.predictions.find((prediction) => prediction.symbol === holding.symbol) ?? crawl?.predictions[0] ?? null;
    const fallbackRiskScore = gainPct <= lossAlertPct ? 70 : gainPct < 0 ? 48 : 28;
    const riskScore = risk?.overall.score ?? command?.risk.score ?? fallbackRiskScore;
    const riskLevel = risk?.overall.level ?? command?.risk.level ?? (riskScore >= 65 ? 'HIGH' : riskScore >= 38 ? 'MODERATE' : 'LOW');
    const decision = risk?.overall.decision ?? (riskScore >= 65 ? 'WAIT' : 'PASS');
    const commandStance = command?.suggestedPlan.stance ?? 'WATCH';
    const crawlerVerdict = crawlPrediction?.verdict ?? 'PENDING';
    const action = this.actionFor(decision, commandStance, crawlerVerdict, riskScore, gainPct, lossAlertPct);
    const evidence = [
      price ? `Live price ${price.source}: Rs. ${round(price.price)}` : 'Live price unavailable; average cost used.',
      risk ? `Pre-trade risk: ${risk.overall.level} / ${risk.overall.score}` : 'Pre-trade risk could not run.',
      command ? `Command stance: ${command.suggestedPlan.stance} / ${command.confidence.score}% confidence` : 'AI command report could not run.',
      crawl
        ? `Deep crawl: ${crawlerVerdict} / ${crawlPrediction?.confidence ?? 0}% with ${crawl.sourceReports.filter((source) => source.status !== 'error').length} usable sources.`
        : 'Deep crawl could not run.',
    ];

    return {
      ...toHoldingDto(holding),
      name: price?.name,
      currentPrice: price ? round(currentPrice) : null,
      currentValue: round(currentValue),
      costBasis: round(costBasis),
      unrealizedGain: round(unrealizedGain),
      gainPct: round(gainPct),
      allocationPct: 0,
      riskLevel,
      riskScore: round(riskScore),
      decision,
      commandStance,
      crawlerVerdict,
      crawlerConfidence: crawlPrediction?.confidence ?? 0,
      crawlerNotices: crawlPrediction?.notices.length ?? 0,
      crawlerSources: crawl?.sourceReports.filter((source) => source.status !== 'error').length ?? 0,
      crawlerSummary: crawl?.summary ?? 'No crawler summary available.',
      action,
      alertIdeas: [...(risk?.alertPlan ?? []), ...(command?.suggestedPlan.alertIdeas ?? [])].slice(0, 4),
      evidence,
    };
  }

  private actionFor(decision: string, stance: string, crawlerVerdict: string, riskScore: number, gainPct: number, lossAlertPct: number): string {
    if (decision === 'AVOID' || stance === 'AVOID' || riskScore >= 80) return 'Reduce exposure or wait for fresh confirmation.';
    if (gainPct <= lossAlertPct) return 'Review exit difficulty and protect with a downside alert.';
    if (crawlerVerdict === 'RISK') return 'Hold only after checking crawler evidence and protective alerts.';
    if (decision === 'WAIT' || riskScore >= 65) return 'Hold only with strict alerts and no averaging down.';
    if (stance === 'ALERT') return 'Keep on watch and let alerts control action.';
    if (crawlerVerdict === 'BULLISH') return 'Hold/watch; crawler evidence supports active monitoring.';
    return 'Hold/watch with normal monitoring.';
  }

  private statusFor(holdings: PortfolioHoldingAnalysis[], riskScore: number, riskThreshold: number, lossAlertPct: number): PortfolioAnalysisReport['status'] {
    if (riskScore >= riskThreshold || holdings.some((h) => h.gainPct <= lossAlertPct || h.decision === 'AVOID')) {
      return 'ATTENTION';
    }
    if (riskScore >= Math.max(38, riskThreshold - 20) || holdings.some((h) => h.decision === 'WAIT')) {
      return 'MONITOR';
    }
    return 'HEALTHY';
  }

  private summaryFor(status: PortfolioAnalysisReport['status'], holdings: PortfolioHoldingAnalysis[], gainPct: number, riskScore: number): string {
    const riskiest = holdings.slice().sort((a, b) => b.riskScore - a.riskScore)[0];
    const largest = holdings.slice().sort((a, b) => b.allocationPct - a.allocationPct)[0];
    return `${status}: portfolio is ${gainPct >= 0 ? 'up' : 'down'} ${Math.abs(gainPct).toFixed(2)}% with weighted risk ${riskScore.toFixed(0)}/100. ${riskiest ? `${riskiest.symbol} is the highest-risk holding.` : ''} ${largest ? `${largest.symbol} is the largest allocation at ${largest.allocationPct.toFixed(2)}%.` : ''}`.trim();
  }

  private async nextRunAt(userId: string): Promise<string | null> {
    const settings = await this.settings.getForUser(userId);
    if (!settings.portfolioBotEnabled || settings.portfolioBotIntervalMinutes <= 0) return null;
    const firstAutoRunAfter = this.firstAutoRunAfter.get(userId);
    if (firstAutoRunAfter) return new Date(firstAutoRunAfter).toISOString();
    const latest = await this.prisma.portfolioAnalysisRun.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    const base = latest?.createdAt.getTime() ?? Date.now();
    return new Date(base + settings.portfolioBotIntervalMinutes * 60_000).toISOString();
  }

  private async mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await worker(items[current], current);
      }
    });
    await Promise.all(runners);
    return results;
  }

  private async runToReport(row: {
    id: string;
    status: string;
    reason: string;
    totalCost: number;
    currentValue: number;
    unrealizedGain: number;
    gainPct: number;
    riskScore: number;
    summary: string;
    decisions: unknown;
    notifiedAt: Date | null;
    createdAt: Date;
  }, userId: string): Promise<PortfolioAnalysisReport> {
    return {
      id: row.id,
      generatedAt: row.createdAt.toISOString(),
      reason: row.reason === 'scheduled' ? 'scheduled' : 'manual',
      status: row.status === 'ATTENTION' ? 'ATTENTION' : row.status === 'MONITOR' ? 'MONITOR' : 'HEALTHY',
      totalCost: row.totalCost,
      currentValue: row.currentValue,
      unrealizedGain: row.unrealizedGain,
      gainPct: row.gainPct,
      riskScore: row.riskScore,
      summary: row.summary,
      holdings: Array.isArray(row.decisions) ? (row.decisions as PortfolioHoldingAnalysis[]) : [],
      nextRunAt: await this.nextRunAt(userId),
      notifiedAt: row.notifiedAt?.toISOString() ?? null,
    };
  }

  private async safeRisk(symbol: string, amount: number, holdingDays: number): Promise<PreTradeRiskReport | null> {
    try {
      return await this.crawler.simulatePreTradeRisk(symbol, amount, holdingDays);
    } catch {
      return null;
    }
  }

  private async safeCommand(symbol: string): Promise<StockCommandReport | null> {
    try {
      return await this.crawler.getStockCommandReport(symbol);
    } catch {
      return null;
    }
  }

  private async safeCrawl(symbol: string): Promise<CrawlPredictionReport | null> {
    try {
      return await this.crawler.analyzeSingleStock(symbol);
    } catch (err) {
      this.logs.warn(`Portfolio Bot deep crawl failed for ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  private normalizeSymbol(symbol: string): string {
    const normalized = symbol.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,12}$/.test(normalized)) {
      throw new BadRequestException('Invalid stock symbol.');
    }
    return normalized;
  }

  private assertPositive(value: number, label: string) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(`Portfolio ${label} must be greater than zero.`);
    }
  }
}
