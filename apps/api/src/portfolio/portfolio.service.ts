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

type PortfolioPriceStatus = 'live' | 'stale' | 'fallback' | 'missing';

export interface PortfolioHoldingDto {
  id: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioTransactionDto {
  id: string;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
  taxes: number;
  amount: number;
  realizedPnl: number;
  note: string | null;
  tradedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioHoldingAnalysis extends PortfolioHoldingDto {
  name?: string;
  currentPrice: number | null;
  currentPriceSource: string | null;
  priceStatus: PortfolioPriceStatus;
  priceTimestamp: string | null;
  currentValue: number;
  costBasis: number;
  unrealizedGain: number;
  gainPct: number;
  dayChangePct: number;
  dayGain: number;
  previousValue: number | null;
  sinceLastRunPct: number | null;
  allocationPct: number;
  sector: string;
  concentrationRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
  liquidityRisk: 'LOW' | 'MODERATE' | 'HIGH';
  riskLevel: string;
  riskScore: number;
  decision: string;
  commandStance: string;
  crawlerVerdict: string;
  crawlerConfidence: number;
  crawlerNotices: number;
  crawlerSources: number;
  crawlerFailedSources: number;
  evidenceLabel: string;
  crawlerSummary: string;
  action: string;
  alertIdeas: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }[];
  evidence: string[];
  dataQuality: string[];
  transactionCount: number;
  realizedGain: number;
  fees: number;
  taxes: number;
  dividends: number;
  netPnl: number;
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
  dataQuality: string[];
  priceStatusCounts: Record<PortfolioPriceStatus, number>;
  sectorAllocations: { sector: string; allocationPct: number; value: number }[];
  concentrationWarning: string | null;
  realizedGain: number;
  fees: number;
  taxes: number;
  dividends: number;
  netPnl: number;
  dayGain: number;
  dayGainPct: number;
  sinceLastRunPct: number | null;
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

type PortfolioTransactionSummary = {
  transactionCount: number;
  buyQuantity: number;
  sellQuantity: number;
  fees: number;
  taxes: number;
  dividends: number;
  realizedGain: number;
  lastTransactionAt: string | null;
};

type PortfolioReportExtras = Pick<
  PortfolioAnalysisReport,
  | 'dataQuality'
  | 'priceStatusCounts'
  | 'sectorAllocations'
  | 'concentrationWarning'
  | 'realizedGain'
  | 'fees'
  | 'taxes'
  | 'dividends'
  | 'netPnl'
  | 'dayGain'
  | 'dayGainPct'
  | 'sinceLastRunPct'
>;

const WORKER_TICK_MS = 60_000;
const DAILY_CIRCUIT_LIMIT_PCT = 15;
const PORTFOLIO_ANALYSIS_CONCURRENCY = 3;
const STALE_PRICE_MS = 24 * 60 * 60 * 1000;

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

function toTransactionDto(row: {
  id: string;
  symbol: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
  taxes: number;
  amount: number;
  realizedPnl: number;
  note: string | null;
  tradedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioTransactionDto {
  return {
    id: row.id,
    symbol: row.symbol,
    type: row.type,
    quantity: row.quantity,
    price: row.price,
    fees: row.fees,
    taxes: row.taxes,
    amount: row.amount,
    realizedPnl: row.realizedPnl,
    note: row.note,
    tradedAt: row.tradedAt.toISOString(),
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

  async listTransactions(userId: string, symbol?: string): Promise<PortfolioTransactionDto[]> {
    const rows = await this.prisma.portfolioTransaction.findMany({
      where: { userId, ...(symbol ? { symbol: this.normalizeSymbol(symbol) } : {}) },
      orderBy: { tradedAt: 'desc' },
      take: 100,
    });
    return rows.map(toTransactionDto);
  }

  async addTransaction(
    userId: string,
    body: {
      symbol: string;
      type: string;
      quantity?: number;
      price?: number;
      fees?: number;
      taxes?: number;
      amount?: number;
      realizedPnl?: number;
      note?: string | null;
      tradedAt?: string | null;
    },
  ): Promise<PortfolioTransactionDto> {
    const symbol = this.normalizeSymbol(body.symbol);
    const type = body.type.trim().toUpperCase();
    if (!['BUY', 'SELL', 'DIVIDEND', 'BONUS', 'FEE', 'TAX', 'ADJUSTMENT'].includes(type)) {
      throw new BadRequestException('Portfolio transaction type is invalid.');
    }
    const quantity = this.assertNonNegative(body.quantity ?? 0, 'transaction quantity');
    const price = this.assertNonNegative(body.price ?? 0, 'transaction price');
    const fees = this.assertNonNegative(body.fees ?? 0, 'transaction fees');
    const taxes = this.assertNonNegative(body.taxes ?? 0, 'transaction taxes');
    const amount = this.assertNonNegative(body.amount ?? quantity * price, 'transaction amount');
    const realizedPnl = Number(body.realizedPnl ?? 0);
    if (!Number.isFinite(realizedPnl)) throw new BadRequestException('Portfolio realized P/L must be a valid number.');

    const tradedAt = body.tradedAt ? new Date(body.tradedAt) : new Date();
    if (Number.isNaN(tradedAt.getTime())) throw new BadRequestException('Portfolio transaction date is invalid.');

    const row = await this.prisma.portfolioTransaction.create({
      data: {
        userId,
        symbol,
        type,
        quantity,
        price,
        fees,
        taxes,
        amount,
        realizedPnl,
        note: body.note?.trim() || null,
        tradedAt,
      },
    });
    void this.queueHoldingChangeAnalysis(userId, `transaction saved: ${symbol}`);
    return toTransactionDto(row);
  }

  async removeTransaction(id: string, userId: string): Promise<{ id: string }> {
    const existing = await this.prisma.portfolioTransaction.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException(`Portfolio transaction ${id} not found`);
    await this.prisma.portfolioTransaction.delete({ where: { id } });
    void this.queueHoldingChangeAnalysis(userId, `transaction removed: ${existing.symbol}`);
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

    const symbols = holdings.map((holding) => holding.symbol);
    const [prices, crawl, historyPairs, previousRun, transactionRows] = await Promise.all([
      this.resolvePortfolioPrices(symbols),
      this.safeBatchCrawl(symbols),
      this.mapWithConcurrency(symbols, PORTFOLIO_ANALYSIS_CONCURRENCY, async (symbol) => ({
        symbol,
        history: await this.crawler.getHistory(symbol, '1d').catch(() => []),
      })),
      this.prisma.portfolioAnalysisRun.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.portfolioTransaction.findMany({
        where: { userId, symbol: { in: symbols } },
        select: {
          symbol: true,
          type: true,
          quantity: true,
          price: true,
          fees: true,
          taxes: true,
          amount: true,
          realizedPnl: true,
          tradedAt: true,
        },
        orderBy: { tradedAt: 'desc' },
      }),
    ]);

    const priceMap = new Map(prices.map((price) => [price.symbol, price]));
    const historyMap = new Map(historyPairs.map((item) => [item.symbol, item.history]));
    const transactionMap = this.summarizeTransactions(transactionRows);
    const previousHoldings = Array.isArray(previousRun?.decisions)
      ? (previousRun.decisions as unknown as Partial<PortfolioHoldingAnalysis>[]).map((holding) => this.normalizeStoredHolding(holding))
      : [];
    const previousBySymbol = new Map(previousHoldings.map((item) => [item.symbol, item]));
    const predictionsBySymbol = new Map((crawl?.predictions ?? []).map((prediction) => [prediction.symbol, prediction]));
    const sourcesBySymbol = new Map<string, NonNullable<CrawlPredictionReport['sourceReports']>>();
    for (const report of crawl?.sourceReports ?? []) {
      const key = report.symbol ?? symbols.find((symbol) => report.url.includes(symbol)) ?? symbols[0];
      sourcesBySymbol.set(key, [...(sourcesBySymbol.get(key) ?? []), report]);
    }

    const analyses = holdings.map((holding) => {
      const price = priceMap.get(holding.symbol) ?? null;
      const priceStatus = this.priceStatusFor(price);
      const currentPrice = price && priceStatus !== 'missing' ? price.price : holding.averageCost;
      const currentValue = currentPrice * holding.quantity;
      const costBasis = holding.averageCost * holding.quantity;
      const unrealizedGain = currentValue - costBasis;
      const gainPct = costBasis > 0 ? (unrealizedGain / costBasis) * 100 : 0;
      return this.buildHoldingAnalysis({
        holding,
        price,
        priceStatus,
        currentPrice,
        currentValue,
        costBasis,
        unrealizedGain,
        gainPct,
        prediction: predictionsBySymbol.get(holding.symbol) ?? null,
        sourceReports: sourcesBySymbol.get(holding.symbol) ?? [],
        crawlSummary: crawl?.summary,
        history: historyMap.get(holding.symbol) ?? [],
        previous: previousBySymbol.get(holding.symbol) ?? null,
        transactionSummary: transactionMap.get(holding.symbol) ?? this.emptyTransactionSummary(),
        lossAlertPct: settings.portfolioBotLossAlertPct,
      });
    });

    const totalCost = analyses.reduce((sum, item) => sum + item.costBasis, 0);
    const currentValue = analyses.reduce((sum, item) => sum + item.currentValue, 0);
    const unrealizedGain = currentValue - totalCost;
    const gainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
    const sectorAllocations = this.sectorAllocationsFor(analyses, currentValue);

    const holdingsWithAllocation = analyses.map((item) => {
      const allocationPct = currentValue > 0 ? round((item.currentValue / currentValue) * 100) : 0;
      return this.enhancePortfolioRisk(item, {
        allocationPct,
        sectorAllocationPct: sectorAllocations.find((sector) => sector.sector === item.sector)?.allocationPct ?? allocationPct,
        lossAlertPct: settings.portfolioBotLossAlertPct,
      });
    });

    const weightedRisk =
      currentValue > 0
        ? holdingsWithAllocation.reduce((sum, item) => sum + item.riskScore * item.currentValue, 0) / currentValue
        : holdingsWithAllocation.reduce((sum, item) => sum + item.riskScore, 0) / Math.max(1, holdingsWithAllocation.length);

    const status = this.statusFor(holdingsWithAllocation, weightedRisk, settings.portfolioBotRiskAlertThreshold, settings.portfolioBotLossAlertPct);
    const extras = this.reportExtras(holdingsWithAllocation, currentValue, previousHoldings);
    const summary = this.summaryFor(status, holdingsWithAllocation, gainPct, weightedRisk, extras);

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
        decisions: JSON.parse(JSON.stringify(holdingsWithAllocation)),
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
        ...extras,
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
      ...extras,
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
    priceStatus: PortfolioPriceStatus;
    currentPrice: number;
    currentValue: number;
    costBasis: number;
    unrealizedGain: number;
    gainPct: number;
    prediction: CrawlPredictionReport['predictions'][number] | null;
    sourceReports: CrawlPredictionReport['sourceReports'];
    crawlSummary?: string;
    history: { timestamp: string; price: number }[];
    previous: PortfolioHoldingAnalysis | null;
    transactionSummary: PortfolioTransactionSummary;
    lossAlertPct: number;
  }): PortfolioHoldingAnalysis {
    const {
      holding,
      price,
      priceStatus,
      currentPrice,
      currentValue,
      costBasis,
      unrealizedGain,
      gainPct,
      prediction,
      sourceReports,
      crawlSummary,
      history,
      previous,
      transactionSummary,
      lossAlertPct,
    } = input;
    const usableSources = sourceReports.filter((source) => source.status === 'done' || source.status === 'warning').length;
    const failedSources = sourceReports.filter((source) => source.status === 'error').length;
    const dayChangePct = this.dayChangePctFor(price, history);
    const dayGain = currentValue * (dayChangePct / 100);
    const previousValue = previous?.currentValue ?? null;
    const sinceLastRunPct = previousValue && previousValue > 0 ? ((currentValue - previousValue) / previousValue) * 100 : null;
    const crawlerVerdict = prediction?.verdict ?? 'PENDING';
    const baseRiskScore = this.baseRiskScoreFor({
      price,
      priceStatus,
      prediction,
      sourceReports,
      gainPct,
      currentValue,
      currentPrice,
      lossAlertPct,
      dayChangePct,
    });
    const riskLevel = this.riskLevelFor(baseRiskScore);
    const decision = this.decisionFor(baseRiskScore);
    const commandStance = this.commandStanceFor(crawlerVerdict, baseRiskScore);
    const action = this.actionFor(decision, commandStance, crawlerVerdict, baseRiskScore, gainPct, lossAlertPct);
    const liquidityRisk = this.liquidityRiskFor(price, currentValue);
    const dataQuality = this.dataQualityFor(priceStatus, price, usableSources, failedSources);
    const alertIdeas = this.alertIdeasFor(currentPrice, gainPct, lossAlertPct, crawlerVerdict);
    const evidence = [
      price
        ? `${priceStatus === 'live' ? 'Live' : priceStatus === 'stale' ? 'Stale' : 'Fallback'} price ${price.source}: Rs. ${round(price.price)}.`
        : 'Market price unavailable; valuation uses average cost until a quote is fetched.',
      `Portfolio P/L: ${gainPct >= 0 ? '+' : ''}${round(gainPct)}% on Rs. ${round(costBasis)} cost basis.`,
      `Crawler evidence: ${prediction?.notices.length ?? 0} matched notice${prediction?.notices.length === 1 ? '' : 's'}, ${usableSources} usable source${usableSources === 1 ? '' : 's'}, ${prediction?.confidence ?? 0}% confidence.`,
      `Liquidity: ${liquidityRisk}; day move estimate ${dayChangePct >= 0 ? '+' : ''}${round(dayChangePct)}%.`,
    ];

    return {
      ...toHoldingDto(holding),
      name: price?.name ?? prediction?.name,
      currentPrice: price ? round(currentPrice) : null,
      currentPriceSource: price?.source ?? null,
      priceStatus,
      priceTimestamp: price?.timestamp ?? null,
      currentValue: round(currentValue),
      costBasis: round(costBasis),
      unrealizedGain: round(unrealizedGain),
      gainPct: round(gainPct),
      dayChangePct: round(dayChangePct),
      dayGain: round(dayGain),
      previousValue: previousValue === null ? null : round(previousValue),
      sinceLastRunPct: sinceLastRunPct === null ? null : round(sinceLastRunPct),
      allocationPct: 0,
      sector: price?.sector ?? prediction?.sector ?? 'Others',
      concentrationRisk: 'LOW',
      liquidityRisk,
      riskLevel,
      riskScore: round(baseRiskScore),
      decision,
      commandStance,
      crawlerVerdict,
      crawlerConfidence: prediction?.confidence ?? 0,
      crawlerNotices: prediction?.notices.length ?? 0,
      crawlerSources: usableSources,
      crawlerFailedSources: failedSources,
      evidenceLabel: `${prediction?.notices.length ?? 0} matched notice${prediction?.notices.length === 1 ? '' : 's'} · ${usableSources}/${sourceReports.length || usableSources} usable sources · ${prediction?.confidence ?? 0}% confidence`,
      crawlerSummary: prediction?.reasons.join(' ') || crawlSummary || 'No crawler summary available.',
      action,
      alertIdeas,
      evidence,
      dataQuality,
      transactionCount: transactionSummary.transactionCount,
      realizedGain: round(transactionSummary.realizedGain),
      fees: round(transactionSummary.fees),
      taxes: round(transactionSummary.taxes),
      dividends: round(transactionSummary.dividends),
      netPnl: round(unrealizedGain + transactionSummary.realizedGain + transactionSummary.dividends - transactionSummary.fees - transactionSummary.taxes),
    };
  }

  private enhancePortfolioRisk(
    holding: PortfolioHoldingAnalysis,
    input: { allocationPct: number; sectorAllocationPct: number; lossAlertPct: number },
  ): PortfolioHoldingAnalysis {
    let score = holding.riskScore;
    if (input.allocationPct >= 70) score += 24;
    else if (input.allocationPct >= 50) score += 18;
    else if (input.allocationPct >= 30) score += 10;
    else if (input.allocationPct >= 15) score += 5;

    if (input.sectorAllocationPct >= 70) score += 10;
    else if (input.sectorAllocationPct >= 45) score += 6;

    const concentrationRisk =
      input.allocationPct >= 70 ? 'EXTREME' : input.allocationPct >= 50 ? 'HIGH' : input.allocationPct >= 25 ? 'MODERATE' : 'LOW';
    score = Math.max(0, Math.min(100, score));
    const riskLevel = this.riskLevelFor(score);
    const decision = this.decisionFor(score);
    const commandStance = this.commandStanceFor(holding.crawlerVerdict, score);
    return {
      ...holding,
      allocationPct: round(input.allocationPct),
      concentrationRisk,
      riskScore: round(score),
      riskLevel,
      decision,
      commandStance,
      action: this.actionFor(decision, commandStance, holding.crawlerVerdict, score, holding.gainPct, input.lossAlertPct),
      evidence: [
        ...holding.evidence,
        `Allocation: ${round(input.allocationPct)}% of portfolio; sector exposure ${round(input.sectorAllocationPct)}%.`,
      ],
    };
  }

  private async resolvePortfolioPrices(symbols: string[]): Promise<PriceSummary[]> {
    const direct = await this.crawler.getFreshPricesForSymbols(symbols).catch((err) => {
      this.logs.warn(`Portfolio Bot fresh price lookup failed: ${(err as Error).message}`);
      return [] as PriceSummary[];
    });
    if (direct.length > 0) return direct;

    const refreshed = await this.crawler.refreshPrices().catch((err) => {
      this.logs.warn(`Portfolio Bot price refresh failed: ${(err as Error).message}`);
      return [] as PriceSummary[];
    });
    const wanted = new Set(symbols);
    return refreshed.filter((price) => wanted.has(price.symbol));
  }

  private async safeBatchCrawl(symbols: string[]): Promise<CrawlPredictionReport | null> {
    try {
      return await this.crawler.analyzeStocks(symbols, 'batch');
    } catch (err) {
      this.logs.warn(`Portfolio Bot batch crawl failed: ${(err as Error).message}`);
      return null;
    }
  }

  private priceStatusFor(price: PriceSummary | null): PortfolioPriceStatus {
    if (!price) return 'missing';
    if (price.source !== 'LIVE') return 'fallback';
    const timestamp = Date.parse(price.timestamp);
    if (!Number.isFinite(timestamp)) return 'stale';
    return Date.now() - timestamp > STALE_PRICE_MS ? 'stale' : 'live';
  }

  private dayChangePctFor(price: PriceSummary | null, history: { timestamp: string; price: number }[]): number {
    if (price?.changePct !== undefined) return price.changePct;
    const first = history.find((item) => item.price > 0);
    const last = [...history].reverse().find((item) => item.price > 0);
    return first && last && first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;
  }

  private baseRiskScoreFor(input: {
    price: PriceSummary | null;
    priceStatus: PortfolioPriceStatus;
    prediction: CrawlPredictionReport['predictions'][number] | null;
    sourceReports: CrawlPredictionReport['sourceReports'];
    gainPct: number;
    currentValue: number;
    currentPrice: number;
    lossAlertPct: number;
    dayChangePct: number;
  }): number {
    let score = 26;
    if (input.priceStatus === 'missing') score += 25;
    else if (input.priceStatus === 'fallback') score += 18;
    else if (input.priceStatus === 'stale') score += 10;

    if (input.gainPct <= input.lossAlertPct) score += 24;
    else if (input.gainPct < 0) score += 8;
    else if (input.gainPct >= 12) score -= 4;

    if (Math.abs(input.dayChangePct) >= 8) score += 10;
    else if (Math.abs(input.dayChangePct) >= 4) score += 5;

    if (input.prediction?.verdict === 'RISK') score += 24;
    else if (input.prediction?.verdict === 'WATCH') score += 8;
    else if (input.prediction?.verdict === 'BULLISH') score -= 5;
    if (input.prediction && input.prediction.confidence < 45) score += 6;

    const negativeNotices = input.prediction?.notices.filter((notice) => notice.sentiment === 'negative').length ?? 0;
    score += Math.min(18, negativeNotices * 9);

    const usableSources = input.sourceReports.filter((source) => source.status === 'done' || source.status === 'warning').length;
    if (usableSources === 0) score += 8;

    if (this.liquidityRiskFor(input.price, input.currentValue) === 'HIGH') score += 14;
    else if (this.liquidityRiskFor(input.price, input.currentValue) === 'MODERATE') score += 7;

    return Math.max(0, Math.min(100, score));
  }

  private liquidityRiskFor(price: PriceSummary | null, currentValue: number): 'LOW' | 'MODERATE' | 'HIGH' {
    if (!price || price.price <= 0 || price.volume <= 0) return 'HIGH';
    const tradedValue = price.turnover > 0 ? price.turnover : price.volume * price.price;
    if (tradedValue <= 0) return 'HIGH';
    const exposurePct = (currentValue / tradedValue) * 100;
    if (exposurePct >= 10 || price.volume < 5_000) return 'HIGH';
    if (exposurePct >= 3 || price.volume < 20_000) return 'MODERATE';
    return 'LOW';
  }

  private dataQualityFor(
    priceStatus: PortfolioPriceStatus,
    price: PriceSummary | null,
    usableSources: number,
    failedSources: number,
  ): string[] {
    const notes: string[] = [];
    if (priceStatus === 'missing') notes.push('LTP missing; value and P/L use average cost fallback.');
    if (priceStatus === 'fallback') notes.push(`Price source is ${price?.source ?? 'fallback'}; verify before trading.`);
    if (priceStatus === 'stale') notes.push('Price timestamp is older than 24 hours.');
    if (usableSources === 0) notes.push('No usable crawl source returned evidence.');
    if (failedSources > 0) notes.push(`${failedSources} crawl source${failedSources === 1 ? '' : 's'} failed.`);
    return notes;
  }

  private alertIdeasFor(
    currentPrice: number,
    gainPct: number,
    lossAlertPct: number,
    verdict: string,
  ): { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }[] {
    if (!currentPrice || currentPrice <= 0) return [];
    const breakoutPct = verdict === 'BULLISH' ? 1.5 : 2.5;
    const stopPct = gainPct <= lossAlertPct ? 2 : Math.max(2, Math.min(8, Math.abs(lossAlertPct)));
    return [
      {
        condition: 'BELOW',
        targetPrice: this.clampAlertTarget(currentPrice, currentPrice * (1 - stopPct / 100)),
        reason: `Protect holding near ${stopPct.toFixed(1)}% downside from latest known price.`,
      },
      {
        condition: 'ABOVE',
        targetPrice: this.clampAlertTarget(currentPrice, currentPrice * (1 + breakoutPct / 100)),
        reason: `Confirm strength above latest range before adding exposure.`,
      },
    ];
  }

  private summarizeTransactions(
    rows: Array<{
      symbol: string;
      type: string;
      quantity: number;
      price: number;
      fees: number;
      taxes: number;
      amount: number;
      realizedPnl: number;
      tradedAt: Date;
    }>,
  ): Map<string, PortfolioTransactionSummary> {
    const map = new Map<string, PortfolioTransactionSummary>();
    for (const row of rows) {
      const symbol = row.symbol.toUpperCase();
      const type = row.type.toUpperCase();
      const current = map.get(symbol) ?? this.emptyTransactionSummary();
      current.transactionCount++;
      current.fees += row.fees;
      current.taxes += row.taxes;
      current.realizedGain += row.realizedPnl;
      current.lastTransactionAt = current.lastTransactionAt ?? row.tradedAt.toISOString();
      if (type === 'BUY') current.buyQuantity += row.quantity;
      if (type === 'SELL') current.sellQuantity += row.quantity;
      if (type === 'DIVIDEND') current.dividends += row.amount || row.price * row.quantity;
      map.set(symbol, current);
    }
    return map;
  }

  private emptyTransactionSummary(): PortfolioTransactionSummary {
    return {
      transactionCount: 0,
      buyQuantity: 0,
      sellQuantity: 0,
      fees: 0,
      taxes: 0,
      dividends: 0,
      realizedGain: 0,
      lastTransactionAt: null,
    };
  }

  private sectorAllocationsFor(
    holdings: Pick<PortfolioHoldingAnalysis, 'sector' | 'currentValue'>[],
    currentValue: number,
  ): { sector: string; allocationPct: number; value: number }[] {
    const values = new Map<string, number>();
    for (const holding of holdings) values.set(holding.sector, (values.get(holding.sector) ?? 0) + holding.currentValue);
    return Array.from(values.entries())
      .map(([sector, value]) => ({
        sector,
        value: round(value),
        allocationPct: currentValue > 0 ? round((value / currentValue) * 100) : 0,
      }))
      .sort((a, b) => b.value - a.value);
  }

  private reportExtras(
    holdings: PortfolioHoldingAnalysis[],
    currentValue: number,
    previousHoldings: PortfolioHoldingAnalysis[],
  ): PortfolioReportExtras {
    const priceStatusCounts: Record<PortfolioPriceStatus, number> = { live: 0, stale: 0, fallback: 0, missing: 0 };
    for (const holding of holdings) priceStatusCounts[holding.priceStatus]++;
    const dataQuality = Array.from(new Set(holdings.flatMap((holding) => holding.dataQuality))).slice(0, 8);
    const sectorAllocations = this.sectorAllocationsFor(holdings, currentValue);
    const largest = holdings.slice().sort((a, b) => b.allocationPct - a.allocationPct)[0];
    const concentrationWarning =
      largest && largest.allocationPct >= 70
        ? `${largest.symbol} is ${largest.allocationPct.toFixed(2)}% of portfolio; concentration risk is extreme.`
        : largest && largest.allocationPct >= 50
          ? `${largest.symbol} is ${largest.allocationPct.toFixed(2)}% of portfolio; concentration risk is high.`
          : null;
    const realizedGain = holdings.reduce((sum, item) => sum + item.realizedGain, 0);
    const fees = holdings.reduce((sum, item) => sum + item.fees, 0);
    const taxes = holdings.reduce((sum, item) => sum + item.taxes, 0);
    const dividends = holdings.reduce((sum, item) => sum + item.dividends, 0);
    const netPnl = holdings.reduce((sum, item) => sum + item.netPnl, 0);
    const dayGain = holdings.reduce((sum, item) => sum + item.dayGain, 0);
    const previousValue = previousHoldings.reduce((sum, item) => sum + (item.currentValue ?? 0), 0);
    return {
      dataQuality,
      priceStatusCounts,
      sectorAllocations,
      concentrationWarning,
      realizedGain: round(realizedGain),
      fees: round(fees),
      taxes: round(taxes),
      dividends: round(dividends),
      netPnl: round(netPnl),
      dayGain: round(dayGain),
      dayGainPct: currentValue > 0 ? round((dayGain / currentValue) * 100) : 0,
      sinceLastRunPct: previousValue > 0 ? round(((currentValue - previousValue) / previousValue) * 100) : null,
    };
  }

  private riskLevelFor(score: number): 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME' {
    if (score >= 82) return 'EXTREME';
    if (score >= 65) return 'HIGH';
    if (score >= 38) return 'MODERATE';
    return 'LOW';
  }

  private decisionFor(score: number): string {
    if (score >= 82) return 'AVOID';
    if (score >= 65) return 'WAIT';
    if (score >= 38) return 'SMALL_POSITION';
    return 'PASS';
  }

  private commandStanceFor(verdict: string, riskScore: number): string {
    if (riskScore >= 82 || verdict === 'RISK') return 'AVOID';
    if (riskScore >= 65) return 'REVIEW';
    if (verdict === 'BULLISH') return 'ALERT';
    return 'WATCH';
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

  private summaryFor(
    status: PortfolioAnalysisReport['status'],
    holdings: PortfolioHoldingAnalysis[],
    gainPct: number,
    riskScore: number,
    extras: PortfolioReportExtras,
  ): string {
    const riskiest = holdings.slice().sort((a, b) => b.riskScore - a.riskScore)[0];
    const largest = holdings.slice().sort((a, b) => b.allocationPct - a.allocationPct)[0];
    const priceQuality =
      extras.priceStatusCounts.fallback || extras.priceStatusCounts.missing || extras.priceStatusCounts.stale
        ? ` Data quality: ${extras.priceStatusCounts.live} live, ${extras.priceStatusCounts.stale} stale, ${extras.priceStatusCounts.fallback} fallback, ${extras.priceStatusCounts.missing} missing prices.`
        : '';
    const concentration = extras.concentrationWarning ? ` ${extras.concentrationWarning}` : '';
    const trend = extras.sinceLastRunPct === null ? '' : ` Since last run ${extras.sinceLastRunPct >= 0 ? '+' : ''}${extras.sinceLastRunPct.toFixed(2)}%.`;
    return `${status}: portfolio is ${gainPct >= 0 ? 'up' : 'down'} ${Math.abs(gainPct).toFixed(2)}% with weighted risk ${riskScore.toFixed(0)}/100. Net P/L ${extras.netPnl >= 0 ? '+' : ''}${extras.netPnl.toFixed(2)} after realized P/L, fees, taxes, and dividends. ${riskiest ? `${riskiest.symbol} is the highest-risk holding.` : ''} ${largest ? `${largest.symbol} is the largest allocation at ${largest.allocationPct.toFixed(2)}%.` : ''}${concentration}${trend}${priceQuality}`.trim();
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
    const holdings = Array.isArray(row.decisions)
      ? (row.decisions as Partial<PortfolioHoldingAnalysis>[]).map((holding) => this.normalizeStoredHolding(holding))
      : [];
    const extras = this.reportExtras(holdings, row.currentValue, []);
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
      holdings,
      ...extras,
      nextRunAt: await this.nextRunAt(userId),
      notifiedAt: row.notifiedAt?.toISOString() ?? null,
    };
  }

  private normalizeStoredHolding(holding: Partial<PortfolioHoldingAnalysis>): PortfolioHoldingAnalysis {
    const currentValue = Number(holding.currentValue ?? 0);
    const costBasis = Number(holding.costBasis ?? 0);
    const unrealizedGain = Number(holding.unrealizedGain ?? currentValue - costBasis);
    const gainPct = Number(holding.gainPct ?? (costBasis > 0 ? (unrealizedGain / costBasis) * 100 : 0));
    const riskScore = Number(holding.riskScore ?? 0);
    const crawlerNotices = Number(holding.crawlerNotices ?? 0);
    const crawlerSources = Number(holding.crawlerSources ?? 0);
    return {
      id: String(holding.id ?? `${holding.symbol ?? 'holding'}-${Date.now()}`),
      symbol: String(holding.symbol ?? 'UNKNOWN'),
      quantity: Number(holding.quantity ?? 0),
      averageCost: Number(holding.averageCost ?? 0),
      note: holding.note ?? null,
      createdAt: String(holding.createdAt ?? new Date().toISOString()),
      updatedAt: String(holding.updatedAt ?? new Date().toISOString()),
      name: holding.name,
      currentPrice: holding.currentPrice ?? null,
      currentPriceSource: holding.currentPriceSource ?? null,
      priceStatus: holding.priceStatus ?? (holding.currentPrice ? 'live' : 'missing'),
      priceTimestamp: holding.priceTimestamp ?? null,
      currentValue: round(currentValue),
      costBasis: round(costBasis),
      unrealizedGain: round(unrealizedGain),
      gainPct: round(gainPct),
      dayChangePct: Number(holding.dayChangePct ?? 0),
      dayGain: Number(holding.dayGain ?? 0),
      previousValue: holding.previousValue ?? null,
      sinceLastRunPct: holding.sinceLastRunPct ?? null,
      allocationPct: Number(holding.allocationPct ?? 0),
      sector: holding.sector ?? 'Others',
      concentrationRisk: holding.concentrationRisk ?? 'LOW',
      liquidityRisk: holding.liquidityRisk ?? 'LOW',
      riskLevel: holding.riskLevel ?? this.riskLevelFor(riskScore),
      riskScore: round(riskScore),
      decision: holding.decision ?? this.decisionFor(riskScore),
      commandStance: holding.commandStance ?? 'WATCH',
      crawlerVerdict: holding.crawlerVerdict ?? 'PENDING',
      crawlerConfidence: Number(holding.crawlerConfidence ?? 0),
      crawlerNotices,
      crawlerSources,
      crawlerFailedSources: Number(holding.crawlerFailedSources ?? 0),
      evidenceLabel:
        holding.evidenceLabel ??
        `${crawlerNotices} matched notice${crawlerNotices === 1 ? '' : 's'} · ${crawlerSources} usable source${crawlerSources === 1 ? '' : 's'}`,
      crawlerSummary: holding.crawlerSummary ?? 'No crawler summary available.',
      action: holding.action ?? 'Run analysis to refresh this holding.',
      alertIdeas: holding.alertIdeas ?? [],
      evidence: holding.evidence ?? [],
      dataQuality: holding.dataQuality ?? [],
      transactionCount: Number(holding.transactionCount ?? 0),
      realizedGain: Number(holding.realizedGain ?? 0),
      fees: Number(holding.fees ?? 0),
      taxes: Number(holding.taxes ?? 0),
      dividends: Number(holding.dividends ?? 0),
      netPnl: Number(holding.netPnl ?? unrealizedGain),
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

  private assertNonNegative(value: number, label: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new BadRequestException(`Portfolio ${label} must be zero or greater.`);
    }
    return value;
  }
}
