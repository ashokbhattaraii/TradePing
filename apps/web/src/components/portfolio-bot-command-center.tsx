'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import type { AlertCondition, StockAlert, StockSymbol } from '@tradeping/types';
import {
  BellPlus,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  Globe2,
  Layers3,
  Loader2,
  Play,
  Radar,
  RefreshCw,
  Route,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Target,
  Trash2,
  WalletCards,
  Zap,
} from 'lucide-react';
import {
  api,
  type CrawlPredictionReport,
  type PortfolioAnalysisReport,
  type PortfolioHolding,
  type PriceSummary,
  type PreTradeRiskReport,
  type StockCommandReport,
  type SystemSettings,
  type Watchlist,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input, Select } from './ui/input';
import { useToast } from './ui/toast';

type MissionStatus = 'pending' | 'running' | 'done' | 'error';
type Tone = 'success' | 'info' | 'warn' | 'danger' | 'default';
type BotMode = 'manage' | 'enter' | 'compare';

type MissionStep = {
  id: string;
  label: string;
  detail: string;
  status: MissionStatus;
  durationMs?: number;
};

type SourceOption = {
  id: string;
  label: string;
  source: string;
};

const DAILY_CIRCUIT_LIMIT_PCT = 15;

const SOURCES: SourceOption[] = [
  { id: 'sharesansar-announcements', label: 'Announcements', source: 'ShareSansar' },
  { id: 'sharesansar-news', label: 'Latest News', source: 'ShareSansar' },
  { id: 'merolagani-news', label: 'Market News', source: 'MeroLagani' },
  { id: 'nepse-notices', label: 'Exchange Notices', source: 'NEPSE' },
  { id: 'nepalipaisa-news', label: 'Stock News', source: 'Nepali Paisa' },
  { id: 'chukul-news', label: 'Market Feed', source: 'Chukul' },
];

const emptySteps: MissionStep[] = [
  { id: 'market', label: 'Read Market Position', detail: 'Price, volume, turnover, and active alerts.', status: 'pending' },
  { id: 'risk', label: 'Run Pre-Trade Risk', detail: '3-pass downside, liquidity, sector, notice, and exit analysis.', status: 'pending' },
  { id: 'command', label: 'Build AI Command Report', detail: 'Why moving, broker pressure, sector comparison, and confidence.', status: 'pending' },
  { id: 'crawl', label: 'Crawl Evidence Sources', detail: 'Selected news, notices, and market websites.', status: 'pending' },
  { id: 'compare', label: 'Compare Candidate', detail: 'Optional side-by-side crawl ranking.', status: 'pending' },
  { id: 'plan', label: 'Prepare Portfolio Tasks', detail: 'Alert ideas, watchlist action, and next action plan.', status: 'pending' },
];

const decisionTone: Record<PreTradeRiskReport['overall']['decision'], Tone> = {
  PASS: 'success',
  SMALL_POSITION: 'info',
  WAIT: 'warn',
  AVOID: 'danger',
};

const stanceTone: Record<StockCommandReport['suggestedPlan']['stance'], Tone> = {
  WATCH: 'info',
  ALERT: 'success',
  AVOID: 'danger',
  REVIEW: 'warn',
};

const verdictTone = {
  BULLISH: 'success',
  WATCH: 'info',
  NEUTRAL: 'default',
  RISK: 'danger',
} as const;

function money(value: number) {
  return new Intl.NumberFormat('en-NP', { maximumFractionDigits: 2 }).format(value);
}

function circuitBounds(price?: number | null) {
  if (!price || price <= 0) return null;
  return {
    lower: Math.round(price * (1 - DAILY_CIRCUIT_LIMIT_PCT / 100) * 10) / 10,
    upper: Math.round(price * (1 + DAILY_CIRCUIT_LIMIT_PCT / 100) * 10) / 10,
  };
}

function insideCircuit(price: number | null | undefined, target: number) {
  const bounds = circuitBounds(price);
  return !bounds || (target >= bounds.lower && target <= bounds.upper);
}

function stockLabel(stock: PriceSummary) {
  return stock.name && stock.name !== stock.symbol ? `${stock.symbol} - ${stock.name}` : stock.symbol;
}

function nowDuration(startedAt: number) {
  return Math.max(1, Math.round(performance.now() - startedAt));
}

function nextDecision(risk: PreTradeRiskReport | null, command: StockCommandReport | null, crawl: CrawlPredictionReport | null) {
  if (risk?.overall.decision === 'AVOID' || command?.suggestedPlan.stance === 'AVOID') return 'Avoid Entry';
  if (risk?.overall.decision === 'WAIT' || crawl?.predictions[0]?.verdict === 'RISK') return 'Wait & Watch';
  if (risk?.overall.decision === 'SMALL_POSITION' || command?.suggestedPlan.stance === 'REVIEW') return 'Small Position';
  if (command?.suggestedPlan.stance === 'ALERT' || crawl?.predictions[0]?.verdict === 'BULLISH') return 'Watch With Alerts';
  return 'Run Bot';
}

export function PortfolioBotCommandCenter({
  stocks,
  alerts,
  watchlists,
  activeWatchlistId,
  onWatchlistsChange,
  onActiveWatchlistIdChange,
  onRefresh,
}: {
  stocks: PriceSummary[];
  alerts: StockAlert[];
  watchlists: Watchlist[];
  activeWatchlistId: string;
  onWatchlistsChange: (watchlists: Watchlist[]) => void;
  onActiveWatchlistIdChange: (id: string) => void;
  onRefresh: () => void;
}) {
  const { push } = useToast();
  const stockOptions = useMemo(() => [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)), [stocks]);
  const [symbol, setSymbol] = useState('');
  const [compareSymbol, setCompareSymbol] = useState('');
  const [amount, setAmount] = useState('100000');
  const [holdingDays, setHoldingDays] = useState('7');
  const [mode, setMode] = useState<BotMode>('manage');
  const [sourceIds, setSourceIds] = useState<string[]>(SOURCES.map((source) => source.id));
  const [steps, setSteps] = useState<MissionStep[]>(emptySteps);
  const [riskReport, setRiskReport] = useState<PreTradeRiskReport | null>(null);
  const [commandReport, setCommandReport] = useState<StockCommandReport | null>(null);
  const [crawlReport, setCrawlReport] = useState<CrawlPredictionReport | null>(null);
  const [comparisonReport, setComparisonReport] = useState<CrawlPredictionReport | null>(null);
  const [running, setRunning] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [holdings, setHoldings] = useState<PortfolioHolding[]>([]);
  const [latestAnalysis, setLatestAnalysis] = useState<PortfolioAnalysisReport | null>(null);
  const [analysisHistory, setAnalysisHistory] = useState<PortfolioAnalysisReport[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(true);
  const [portfolioAnalyzing, setPortfolioAnalyzing] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [averageCost, setAverageCost] = useState('');
  const [holdingNote, setHoldingNote] = useState('');
  const [notifySlack, setNotifySlack] = useState(true);
  const selectedStock = stockOptions.find((stock) => stock.symbol === symbol) ?? null;
  const selectedAlerts = alerts.filter((alert) => alert.symbol === symbol);
  const selectedWatchlist = watchlists.find((list) => list.id === activeWatchlistId) ?? watchlists[0] ?? null;
  const watched = Boolean(selectedWatchlist?.symbols.includes(symbol));
  const finalDecision = nextDecision(riskReport, commandReport, crawlReport);
  const sourceNames = SOURCES.filter((source) => sourceIds.includes(source.id)).map((source) => source.source);
  const selectedCircuit = circuitBounds(selectedStock?.price);

  useEffect(() => {
    if (!symbol && stockOptions[0]) setSymbol(stockOptions[0].symbol);
    if (!compareSymbol && stockOptions[1]) setCompareSymbol(stockOptions[1].symbol);
  }, [compareSymbol, stockOptions, symbol]);

  const loadPortfolioData = async () => {
    setPortfolioLoading(true);
    try {
      const [holdingRes, analysisRes, historyRes, settingsRes] = await Promise.all([
        api.listPortfolioHoldings(),
        api.latestPortfolioAnalysis(),
        api.portfolioAnalysisHistory(),
        api.getSettings(),
      ]);
      setHoldings(holdingRes.data);
      setLatestAnalysis(analysisRes.data);
      setAnalysisHistory(historyRes.data);
      setSettings(settingsRes.data);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to load portfolio bot data.');
    } finally {
      setPortfolioLoading(false);
    }
  };

  useEffect(() => {
    void loadPortfolioData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshPortfolioData = async () => {
    await loadPortfolioData();
    push('success', 'Portfolio Bot refreshed');
  };

  const updateAutomation = async (patch: Partial<Omit<SystemSettings, 'port'>>) => {
    setAutomationSaving(true);
    try {
      const res = await api.updateSettings(patch);
      setSettings(res.data);
      push('success', patch.portfolioBotEnabled === true ? 'Auto Mode enabled. First analysis will run in the background.' : 'Portfolio Bot automation updated');
    } catch (err) {
      push('error', (err as Error).message || 'Failed to update Portfolio Bot automation.');
    } finally {
      setAutomationSaving(false);
    }
  };

  const updateAutomationNumber = (key: keyof Pick<SystemSettings,
    'portfolioBotIntervalMinutes' | 'portfolioBotSlackRepeatMinutes' | 'portfolioBotDefaultHoldingDays' | 'portfolioBotRiskAlertThreshold' | 'portfolioBotLossAlertPct'
  >, value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    void updateAutomation({ [key]: number } as Partial<Omit<SystemSettings, 'port'>>);
  };

  useEffect(() => {
    const existing = holdings.find((holding) => holding.symbol === symbol);
    if (existing) {
      setQuantity(String(existing.quantity));
      setAverageCost(String(existing.averageCost));
      setHoldingNote(existing.note ?? '');
    }
  }, [holdings, symbol]);

  const resetReports = () => {
    setRiskReport(null);
    setCommandReport(null);
    setCrawlReport(null);
    setComparisonReport(null);
    setSteps(emptySteps);
  };

  const markStep = (id: string, patch: Partial<MissionStep>) => {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, ...patch } : step)));
  };

  const saveHolding = async () => {
    if (!symbol) {
      push('error', 'Select a stock before saving a holding.');
      return;
    }
    const numericQuantity = Number(quantity);
    const numericAverageCost = Number(averageCost);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      push('error', 'Enter holding quantity greater than zero.');
      return;
    }
    if (!Number.isFinite(numericAverageCost) || numericAverageCost <= 0) {
      push('error', 'Enter average cost greater than zero.');
      return;
    }

    setBusyAction('save-holding');
    try {
      const res = await api.savePortfolioHolding({
        symbol,
        quantity: numericQuantity,
        averageCost: numericAverageCost,
        note: holdingNote,
      });
      setHoldings((current) => {
        const exists = current.some((holding) => holding.id === res.data.id);
        return exists
          ? current.map((holding) => (holding.id === res.data.id ? res.data : holding))
          : [...current, res.data].sort((a, b) => a.symbol.localeCompare(b.symbol));
      });
      push('success', `${res.data.symbol} holding saved`);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to save portfolio holding.');
    } finally {
      setBusyAction('');
    }
  };

  const removeHolding = async (holding: PortfolioHolding) => {
    setBusyAction(`delete-${holding.id}`);
    try {
      await api.deletePortfolioHolding(holding.id);
      setHoldings((current) => current.filter((item) => item.id !== holding.id));
      push('info', `${holding.symbol} removed from portfolio`);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to remove portfolio holding.');
    } finally {
      setBusyAction('');
    }
  };

  const runPortfolioAnalysis = async () => {
    setPortfolioAnalyzing(true);
    try {
      const res = await api.analyzePortfolio(notifySlack);
      setLatestAnalysis(res.data);
      setAnalysisHistory((current) => [res.data, ...current.filter((item) => item.id !== res.data.id)].slice(0, 20));
      push('success', notifySlack ? 'Portfolio analysis completed and Slack was requested' : 'Portfolio analysis completed');
    } catch (err) {
      push('error', (err as Error).message || 'Failed to analyze portfolio.');
    } finally {
      setPortfolioAnalyzing(false);
    }
  };

  const runMission = async () => {
    if (!symbol) {
      push('error', 'Select a stock before starting the portfolio bot.');
      return;
    }
    const numericAmount = Number(amount);
    const numericHoldingDays = Number(holdingDays);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      push('error', 'Enter an investment amount greater than zero.');
      return;
    }
    if (sourceIds.length === 0) {
      push('error', 'Select at least one crawling source.');
      return;
    }

    setRunning(true);
    setRiskReport(null);
    setCommandReport(null);
    setCrawlReport(null);
    setComparisonReport(null);
    setSteps(emptySteps.map((step) => ({ ...step, status: 'pending', durationMs: undefined })));

    try {
      let startedAt = performance.now();
      markStep('market', { status: 'running', detail: 'Reading selected stock, active alerts, and watchlist state.' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      markStep('market', {
        status: 'done',
        detail: selectedStock
          ? `Live snapshot found at Rs. ${money(selectedStock.price)} with ${selectedAlerts.length} related alert${selectedAlerts.length === 1 ? '' : 's'}.`
          : 'Live price is not loaded yet; reports will use crawler fallback where available.',
        durationMs: nowDuration(startedAt),
      });

      startedAt = performance.now();
      markStep('risk', { status: 'running', detail: 'Running three same-scenario risk iterations.' });
      const risk = await api.preTradeRisk({
        symbol,
        amount: numericAmount,
        holdingDays: Number.isFinite(numericHoldingDays) ? numericHoldingDays : 7,
      });
      setRiskReport(risk.data);
      markStep('risk', {
        status: 'done',
        detail: `${risk.data.overall.decision.replace('_', ' ')} with ${risk.data.overall.level} risk and ${risk.data.liquidityRisk.estimatedExitDays} estimated exit day${risk.data.liquidityRisk.estimatedExitDays === 1 ? '' : 's'}.`,
        durationMs: nowDuration(startedAt),
      });

      startedAt = performance.now();
      markStep('command', { status: 'running', detail: 'Building AI command report from movement, notices, broker activity, and sector data.' });
      const command = await api.stockCommand(symbol);
      setCommandReport(command.data);
      markStep('command', {
        status: 'done',
        detail: `${command.data.suggestedPlan.stance} stance with ${command.data.confidence.score}% confidence.`,
        durationMs: nowDuration(startedAt),
      });

      startedAt = performance.now();
      markStep('crawl', { status: 'running', detail: `Crawling ${sourceIds.length} selected source${sourceIds.length === 1 ? '' : 's'} for evidence.` });
      const crawl = await api.predictStock(symbol, sourceIds);
      setCrawlReport(crawl.data);
      markStep('crawl', {
        status: 'done',
        detail: crawl.data.summary || `Crawled ${crawl.data.sourceReports.length} source${crawl.data.sourceReports.length === 1 ? '' : 's'}.`,
        durationMs: nowDuration(startedAt),
      });

      startedAt = performance.now();
      if (compareSymbol && compareSymbol !== symbol && (mode === 'compare' || mode === 'manage')) {
        markStep('compare', { status: 'running', detail: `Comparing ${symbol} against ${compareSymbol}.` });
        const comparison = await api.compareStocks([symbol, compareSymbol], sourceIds);
        setComparisonReport(comparison.data);
        markStep('compare', {
          status: 'done',
          detail: comparison.data.winner ? `${comparison.data.winner} ranked strongest in comparison crawl.` : comparison.data.summary,
          durationMs: nowDuration(startedAt),
        });
      } else {
        markStep('compare', {
          status: 'done',
          detail: 'Comparison skipped because no separate candidate was selected.',
          durationMs: nowDuration(startedAt),
        });
      }

      startedAt = performance.now();
      markStep('plan', { status: 'running', detail: 'Preparing portfolio action queue.' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      markStep('plan', {
        status: 'done',
        detail: 'Portfolio bot plan is ready: review stance, create alerts, and add to watchlist if useful.',
        durationMs: nowDuration(startedAt),
      });
      push('success', `Portfolio bot finished ${symbol}`);
    } catch (err) {
      setSteps((current) =>
        current.map((step) => (step.status === 'running' ? { ...step, status: 'error', detail: (err as Error).message || 'Bot task failed.' } : step)),
      );
      push('error', (err as Error).message || 'Portfolio bot mission failed.');
    } finally {
      setRunning(false);
    }
  };

  const toggleSource = (id: string) => {
    setSourceIds((current) => (current.includes(id) ? current.filter((sourceId) => sourceId !== id) : [...current, id]));
  };

  const addToWatchlist = async () => {
    if (!symbol || !selectedWatchlist) return;
    setBusyAction('watchlist');
    try {
      const res = await api.addToWatchlist(selectedWatchlist.id, symbol);
      const next = watchlists.some((list) => list.id === res.data.id)
        ? watchlists.map((list) => (list.id === res.data.id ? res.data : list))
        : [...watchlists, res.data];
      onWatchlistsChange(next);
      onActiveWatchlistIdChange(res.data.id);
      push('success', `${symbol} added to ${res.data.name}`);
    } catch (err) {
      push('error', (err as Error).message || `Failed to add ${symbol} to watchlist.`);
    } finally {
      setBusyAction('');
    }
  };

  const createAlert = async (idea: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }, source: string) => {
    if (!symbol) return;
    const key = `${source}-${idea.condition}-${idea.targetPrice}`;
    if (selectedStock && !insideCircuit(selectedStock.price, idea.targetPrice)) {
      const bounds = circuitBounds(selectedStock.price);
      push(
        'error',
        `${symbol} alert must stay inside Rs. ${bounds?.lower.toLocaleString('en-NP')} - Rs. ${bounds?.upper.toLocaleString('en-NP')}.`,
      );
      return;
    }
    setBusyAction(key);
    try {
      await api.createAlert({
        symbol: symbol as StockSymbol,
        condition: idea.condition as AlertCondition,
        targetPrice: idea.targetPrice,
        priority: riskReport?.overall.level === 'HIGH' || riskReport?.overall.level === 'EXTREME' ? 'HIGH' : 'MEDIUM',
        note: `Portfolio Bot ${source}: ${idea.reason}`,
      });
      push('success', `${symbol} ${idea.condition} alert created`);
      onRefresh();
    } catch (err) {
      push('error', (err as Error).message || 'Failed to create bot alert.');
    } finally {
      setBusyAction('');
    }
  };

  const alertIdeas = [
    ...(riskReport?.alertPlan.map((idea) => ({ ...idea, source: 'Risk' })) ?? []),
    ...(commandReport?.suggestedPlan.alertIdeas.map((idea) => ({ ...idea, source: 'Command' })) ?? []),
  ].slice(0, 6);

  return (
    <section className="grid gap-5">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-sky-400/10">
                <Bot className="h-5 w-5 text-sky-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white text-balance">Portfolio Bot Command Center</h3>
                <p className="truncate text-sm text-white/45">
                  One menu for pre-trade risk, AI command, crawling, comparison, alerts, and watchlist actions.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,340px)_auto]">
              <label className="block">
                <span className="sr-only">Select portfolio stock</span>
                <Select
                  name="portfolioBotStock"
                  aria-label="Select portfolio stock"
                  value={symbol}
                  onChange={(event) => {
                    setSymbol(event.target.value);
                    resetReports();
                  }}
                >
                  {stockOptions.length === 0 ? (
                    <option value="">Waiting for live stocks…</option>
                  ) : (
                    stockOptions.map((stock) => (
                      <option key={stock.symbol} value={stock.symbol} className="bg-zinc-900">
                        {stockLabel(stock)}
                      </option>
                    ))
                  )}
                </Select>
              </label>
              <Button type="button" onClick={runMission} loading={running} disabled={!symbol}>
                <Play className="h-4 w-4" aria-hidden="true" />
                Start Bot
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-0 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="border-b border-white/10 p-5 xl:border-b-0 xl:border-r">
            <div className="grid gap-4">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1">
                {(['manage', 'enter', 'compare'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={mode === item}
                    onClick={() => setMode(item)}
                    className={cn(
                      'h-9 rounded-md text-xs font-semibold capitalize transition-[background-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                      mode === item ? 'bg-sky-400/15 text-white' : 'text-white/45 hover:bg-white/[0.05] hover:text-white',
                    )}
                  >
                    {item}
                  </button>
                ))}
              </div>

              <PanelTitle icon={WalletCards} title="Actual Portfolio Holdings" />
              <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Quantity</span>
                    <Input
                      name="portfolioHoldingQuantity"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      autoComplete="off"
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Avg. Cost</span>
                    <Input
                      name="portfolioHoldingAverageCost"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      autoComplete="off"
                      value={averageCost}
                      onChange={(event) => setAverageCost(event.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Note</span>
                  <Input
                    name="portfolioHoldingNote"
                    autoComplete="off"
                    placeholder="Entry reason, TMS note, broker, plan…"
                    value={holdingNote}
                    onChange={(event) => setHoldingNote(event.target.value)}
                  />
                </label>
                <Button type="button" variant="secondary" onClick={saveHolding} loading={busyAction === 'save-holding'} disabled={!symbol}>
                  <WalletCards className="h-4 w-4" aria-hidden="true" />
                  Save Holding
                </Button>

                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {portfolioLoading ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-4 text-sm text-white/40">Loading holdings…</div>
                  ) : holdings.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/40">
                      Add your TMS holdings manually so the bot can manage real exposure.
                    </div>
                  ) : (
                    holdings.map((holding) => (
                      <div
                        key={holding.id}
                        className={cn(
                          'grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg border p-2 transition-[background-color,border-color]',
                          holding.symbol === symbol ? 'border-sky-400/35 bg-sky-400/10' : 'border-white/10 bg-black/15 hover:border-white/20',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSymbol(holding.symbol)}
                          className="min-w-0 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                        >
                          <span className="block min-w-0">
                            <span className="block font-mono text-sm font-semibold text-white">{holding.symbol}</span>
                            <span className="block truncate text-xs text-white/40">
                              {holding.quantity} units @ Rs. {money(holding.averageCost)}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${holding.symbol} holding`}
                          onClick={() => void removeHolding(holding)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-red-400/10 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                        >
                          {busyAction === `delete-${holding.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/15 px-3 py-2">
                  <span className="text-sm text-white/65">Request Slack summary</span>
                  <input
                    name="portfolioBotNotifySlack"
                    type="checkbox"
                    checked={notifySlack}
                    onChange={(event) => setNotifySlack(event.target.checked)}
                    className="h-4 w-4 accent-sky-400"
                  />
                </label>
                <Button type="button" onClick={runPortfolioAnalysis} loading={portfolioAnalyzing} disabled={holdings.length === 0}>
                  <Bot className="h-4 w-4" aria-hidden="true" />
                  Analyze Actual Portfolio
                </Button>
              </div>

              <PanelTitle icon={WalletCards} title="Portfolio Setup" />
              <div className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Investment Amount</span>
                  <Input
                    name="portfolioBotAmount"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    autoComplete="off"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      resetReports();
                    }}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Target Holding Days</span>
                  <Input
                    name="portfolioBotHoldingDays"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    autoComplete="off"
                    value={holdingDays}
                    onChange={(event) => {
                      setHoldingDays(event.target.value);
                      resetReports();
                    }}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Compare Against</span>
                  <Select
                    name="portfolioBotCompareStock"
                    aria-label="Select comparison stock"
                    value={compareSymbol}
                    onChange={(event) => {
                      setCompareSymbol(event.target.value);
                      setComparisonReport(null);
                    }}
                  >
                    {stockOptions.map((stock) => (
                      <option key={stock.symbol} value={stock.symbol} className="bg-zinc-900">
                        {stockLabel(stock)}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              <PanelTitle icon={Layers3} title="Crawler Sources" />
              <div className="grid gap-2">
                {SOURCES.map((source) => {
                  const checked = sourceIds.includes(source.id);
                  return (
                    <label
                      key={source.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-[background-color,border-color]',
                        checked ? 'border-emerald-400/25 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
                      )}
                    >
                      <input
                        name={`portfolioBotSource-${source.id}`}
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSource(source.id)}
                        className="h-4 w-4 accent-emerald-400"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">{source.label}</span>
                        <span className="block truncate text-xs text-white/40">{source.source}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="grid gap-5 p-5">
            <BotSummary
              selectedStock={selectedStock}
              finalDecision={finalDecision}
              riskReport={riskReport}
              commandReport={commandReport}
              crawlReport={crawlReport}
              activeAlerts={selectedAlerts.length}
              watched={watched}
            />

            <AutoModePanel
              settings={settings}
              loading={portfolioLoading || automationSaving}
              analyzing={portfolioAnalyzing}
              holdingsCount={holdings.length}
              latestAnalysis={latestAnalysis}
              onRefresh={refreshPortfolioData}
              onRunNow={runPortfolioAnalysis}
              onToggle={(enabled) => updateAutomation({ portfolioBotEnabled: enabled })}
              onBooleanChange={(key, value) => updateAutomation({ [key]: value } as Partial<Omit<SystemSettings, 'port'>>)}
              onNumberChange={updateAutomationNumber}
            />

            <PortfolioPerformanceTable holdings={holdings} report={latestAnalysis} stocks={stocks} loading={portfolioLoading || portfolioAnalyzing} />

            <MarketCircuitPanel selectedStock={selectedStock} bounds={selectedCircuit} />

            <PortfolioAnalysisPanel report={latestAnalysis} loading={portfolioLoading || portfolioAnalyzing} />

            <AutomationHistoryPanel history={analysisHistory} loading={portfolioLoading} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(360px,1.1fr)]">
              <div className="rounded-lg border border-white/10 bg-black/15 p-4">
                <PanelTitle icon={Route} title="Bot Task Timeline" />
                <div className="mt-4 grid gap-3">
                  {steps.map((step, index) => (
                    <StepRow key={step.id} step={step} index={index} />
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <ActionPanel
                  symbol={symbol}
                  selectedPrice={selectedStock?.price ?? null}
                  sourceNames={sourceNames}
                  selectedWatchlist={selectedWatchlist}
                  watched={watched}
                  busyAction={busyAction}
                  alertIdeas={alertIdeas}
                  onAddToWatchlist={addToWatchlist}
                  onCreateAlert={createAlert}
                />
                <PortfolioEvidence
                  riskReport={riskReport}
                  commandReport={commandReport}
                  crawlReport={crawlReport}
                  comparisonReport={comparisonReport}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>
  );
}

function AutoModePanel({
  settings,
  loading,
  analyzing,
  holdingsCount,
  latestAnalysis,
  onRefresh,
  onRunNow,
  onToggle,
  onBooleanChange,
  onNumberChange,
}: {
  settings: SystemSettings | null;
  loading: boolean;
  analyzing: boolean;
  holdingsCount: number;
  latestAnalysis: PortfolioAnalysisReport | null;
  onRefresh: () => void;
  onRunNow: () => void;
  onToggle: (enabled: boolean) => void;
  onBooleanChange: (key: 'portfolioBotSlackEnabled' | 'portfolioBotAutoCreateAlerts' | 'portfolioBotAnalyzeOnHoldingChange', value: boolean) => void;
  onNumberChange: (
    key: keyof Pick<
      SystemSettings,
      'portfolioBotIntervalMinutes' | 'portfolioBotSlackRepeatMinutes' | 'portfolioBotDefaultHoldingDays' | 'portfolioBotRiskAlertThreshold' | 'portfolioBotLossAlertPct'
    >,
    value: string,
  ) => void;
}) {
  const enabled = Boolean(settings?.portfolioBotEnabled);
  const nextRun = latestAnalysis?.nextRunAt ? new Date(latestAnalysis.nextRunAt) : null;

  return (
    <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.045] p-5">
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PanelTitle icon={Zap} title="Auto Mode" />
            <Badge tone={enabled ? 'success' : 'default'}>{enabled ? 'ON' : 'OFF'}</Badge>
            {settings?.portfolioBotAutoCreateAlerts && <Badge tone="info">Auto Alerts</Badge>}
            {settings?.portfolioBotSlackEnabled && <Badge tone="success">Slack</Badge>}
          </div>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-white/55">
            Auto Mode recalculates every holding, maintains bot alerts inside the NEPSE circuit range, and sends Slack summaries on your schedule.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/40">
            <span>{holdingsCount} holding{holdingsCount === 1 ? '' : 's'} tracked</span>
            <span>Interval {settings?.portfolioBotIntervalMinutes ?? '—'} min</span>
            <span>Slack gap {settings?.portfolioBotSlackRepeatMinutes ?? '—'} min</span>
            <span>{nextRun ? `Next run ${nextRun.toLocaleString()}` : 'Next run waiting'}</span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[430px]">
          <Button type="button" onClick={() => onToggle(!enabled)} loading={loading} disabled={!settings}>
            <Bot className="h-4 w-4" aria-hidden="true" />
            {enabled ? 'Turn Off' : 'Turn On'}
          </Button>
          <Button type="button" variant="secondary" onClick={onRunNow} loading={analyzing} disabled={holdingsCount === 0}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Run Now
          </Button>
          <Button type="button" variant="secondary" onClick={onRefresh} loading={loading}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <AutomationNumberInput label="Analyze Every" unit="min" value={settings?.portfolioBotIntervalMinutes} onCommit={(value) => onNumberChange('portfolioBotIntervalMinutes', value)} />
        <AutomationNumberInput label="Slack Repeat Gap" unit="min" value={settings?.portfolioBotSlackRepeatMinutes} onCommit={(value) => onNumberChange('portfolioBotSlackRepeatMinutes', value)} />
        <AutomationNumberInput label="Risk Holding Frame" unit="days" value={settings?.portfolioBotDefaultHoldingDays} onCommit={(value) => onNumberChange('portfolioBotDefaultHoldingDays', value)} />
        <AutomationNumberInput label="Risk Warning" unit="/100" value={settings?.portfolioBotRiskAlertThreshold} onCommit={(value) => onNumberChange('portfolioBotRiskAlertThreshold', value)} />
        <AutomationNumberInput label="Loss Warning" unit="%" value={settings?.portfolioBotLossAlertPct} onCommit={(value) => onNumberChange('portfolioBotLossAlertPct', value)} />
        <div className="grid gap-2 rounded-lg border border-white/10 bg-black/15 p-3">
          <AutomationToggle label="Slack summaries" checked={Boolean(settings?.portfolioBotSlackEnabled)} onChange={(value) => onBooleanChange('portfolioBotSlackEnabled', value)} disabled={!settings || loading} />
          <AutomationToggle label="Auto alerts" checked={Boolean(settings?.portfolioBotAutoCreateAlerts)} onChange={(value) => onBooleanChange('portfolioBotAutoCreateAlerts', value)} disabled={!settings || loading} />
          <AutomationToggle label="Analyze changes" checked={Boolean(settings?.portfolioBotAnalyzeOnHoldingChange)} onChange={(value) => onBooleanChange('portfolioBotAnalyzeOnHoldingChange', value)} disabled={!settings || loading} />
        </div>
      </div>
    </div>
  );
}

function AutomationNumberInput({
  label,
  unit,
  value,
  onCommit,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="block rounded-lg border border-white/10 bg-black/15 p-3">
      <span className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        {label}
      </span>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <Input
          key={`${label}-${value ?? ''}`}
          type="number"
          defaultValue={value ?? ''}
          onBlur={(event) => onCommit(event.target.value)}
          className="h-9"
        />
        <span className="text-xs text-white/40">{unit}</span>
      </div>
    </label>
  );
}

function AutomationToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 text-sm text-white/65">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-emerald-400"
      />
    </label>
  );
}

function PortfolioPerformanceTable({
  holdings,
  report,
  stocks,
  loading,
}: {
  holdings: PortfolioHolding[];
  report: PortfolioAnalysisReport | null;
  stocks: PriceSummary[];
  loading: boolean;
}) {
  const analysisBySymbol = new Map((report?.holdings ?? []).map((holding) => [holding.symbol, holding]));
  const priceBySymbol = new Map(stocks.map((stock) => [stock.symbol, stock]));

  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <PanelTitle icon={Table2} title="Portfolio Price & Performance" />
          <p className="mt-1 text-sm text-white/45">Bot-managed holdings, live price, P/L, allocation, risk, and active action.</p>
        </div>
        <Badge tone={report ? 'success' : 'default'}>{report ? new Date(report.generatedAt).toLocaleTimeString() : 'Waiting'}</Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-separate border-spacing-y-2 text-left text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-3 py-1">Stock</th>
              <th className="px-3 py-1 text-right">Qty</th>
              <th className="px-3 py-1 text-right">Avg</th>
              <th className="px-3 py-1 text-right">LTP</th>
              <th className="px-3 py-1 text-right">Value</th>
              <th className="px-3 py-1 text-right">P/L</th>
                <th className="px-3 py-1 text-right">Alloc</th>
                <th className="px-3 py-1">Crawler</th>
                <th className="px-3 py-1">Bot Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && holdings.length === 0 ? (
              <tr><td colSpan={9} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-6 text-center text-white/40">Loading portfolio table…</td></tr>
            ) : holdings.length === 0 ? (
              <tr><td colSpan={9} className="rounded-lg border border-dashed border-white/10 px-3 py-8 text-center text-white/40">Add holdings to activate the portfolio table.</td></tr>
            ) : (
              holdings.map((holding) => {
                const analysis = analysisBySymbol.get(holding.symbol);
                const live = priceBySymbol.get(holding.symbol);
                const currentPrice = analysis?.currentPrice ?? live?.price ?? holding.averageCost;
                const value = analysis?.currentValue ?? currentPrice * holding.quantity;
                const cost = analysis?.costBasis ?? holding.averageCost * holding.quantity;
                const gain = analysis?.unrealizedGain ?? value - cost;
                const gainPct = analysis?.gainPct ?? (cost > 0 ? (gain / cost) * 100 : 0);
                const positive = gain >= 0;
                return (
                  <tr key={holding.id} className="group">
                    <td className="rounded-l-lg border-y border-l border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="font-mono font-semibold text-white">{holding.symbol}</div>
                      <div className="max-w-52 truncate text-xs text-white/35">{analysis?.name ?? live?.name ?? holding.note ?? 'Manual holding'}</div>
                    </td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono text-white/75">{money(holding.quantity)}</td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono text-white/75">Rs. {money(holding.averageCost)}</td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono text-white">Rs. {money(currentPrice)}</td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono text-white">Rs. {money(value)}</td>
                    <td className={cn('border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono', positive ? 'text-emerald-300' : 'text-red-300')}>
                      {positive ? '+' : ''}Rs. {money(gain)}<br />
                      <span className="text-xs">{positive ? '+' : ''}{gainPct.toFixed(2)}%</span>
                    </td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3 text-right font-mono text-white/75">{(analysis?.allocationPct ?? 0).toFixed(2)}%</td>
                    <td className="border-y border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={analysis?.crawlerVerdict === 'RISK' ? 'danger' : analysis?.crawlerVerdict === 'BULLISH' ? 'success' : analysis ? 'info' : 'default'}>
                          {analysis?.crawlerVerdict ?? 'Pending'}
                        </Badge>
                        {analysis && <span className="font-mono text-xs text-white/45">{analysis.crawlerNotices}/{analysis.crawlerSources}</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/35">{analysis?.crawlerSummary ?? 'Auto crawl runs with portfolio analysis.'}</p>
                    </td>
                    <td className="rounded-r-lg border-y border-r border-white/10 bg-white/[0.03] px-3 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={analysis?.riskScore && analysis.riskScore >= 65 ? 'danger' : analysis?.riskScore && analysis.riskScore >= 38 ? 'warn' : 'success'}>
                          {analysis ? `${analysis.riskScore.toFixed(0)}/100` : 'Pending'}
                        </Badge>
                        {analysis && <Badge tone={analysis.decision === 'AVOID' ? 'danger' : analysis.decision === 'WAIT' ? 'warn' : 'success'}>{analysis.decision.replace('_', ' ')}</Badge>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{analysis?.action ?? 'Run analysis to let the bot manage this holding.'}</p>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AutomationHistoryPanel({ history, loading }: { history: PortfolioAnalysisReport[]; loading: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <PanelTitle icon={SlidersHorizontal} title="Automation Runs" />
        <Badge tone="default">{history.length} runs</Badge>
      </div>
      <div className="grid gap-2">
        {loading && history.length === 0 ? (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-4 text-sm text-white/40">Loading runs…</div>
        ) : history.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/40">No automation run has been recorded yet.</div>
        ) : (
          history.slice(0, 6).map((run) => (
            <div key={run.id ?? run.generatedAt} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 md:grid-cols-[minmax(0,1fr)_120px_120px_130px] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={run.status === 'HEALTHY' ? 'success' : run.status === 'MONITOR' ? 'warn' : 'danger'}>{run.status}</Badge>
                  <Badge tone="default">{run.reason}</Badge>
                  {run.notifiedAt && <Badge tone="info">Slack</Badge>}
                </div>
                <p className="mt-1 truncate text-xs text-white/45">{new Date(run.generatedAt).toLocaleString()}</p>
              </div>
              <InfoPill label="Value" value={`Rs. ${money(run.currentValue)}`} />
              <InfoPill label="P/L" value={`${run.unrealizedGain >= 0 ? '+' : ''}${run.gainPct.toFixed(2)}%`} tone={run.unrealizedGain >= 0 ? 'success' : 'danger'} />
              <InfoPill label="Risk" value={`${run.riskScore.toFixed(0)}/100`} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function BotSummary({
  selectedStock,
  finalDecision,
  riskReport,
  commandReport,
  crawlReport,
  activeAlerts,
  watched,
}: {
  selectedStock: PriceSummary | null;
  finalDecision: string;
  riskReport: PreTradeRiskReport | null;
  commandReport: StockCommandReport | null;
  crawlReport: CrawlPredictionReport | null;
  activeAlerts: number;
  watched: boolean;
}) {
  const up = (selectedStock?.changePct ?? 0) >= 0;
  return (
    <div className="grid items-start gap-3 2xl:grid-cols-[minmax(320px,1.15fr)_repeat(4,minmax(135px,0.55fr))]">
      <div className="rounded-lg border border-white/10 bg-black/20 p-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-mono text-2xl font-bold text-white sm:text-3xl">{selectedStock?.symbol ?? '—'}</h3>
              <Badge tone={finalDecision === 'Avoid Entry' ? 'danger' : finalDecision === 'Wait & Watch' ? 'warn' : 'success'}>{finalDecision}</Badge>
              {watched && <Badge tone="info">Watched</Badge>}
            </div>
            {selectedStock?.name && selectedStock.name !== selectedStock.symbol && <p className="mt-1 truncate text-sm text-white/50">{selectedStock.name}</p>}
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/40">
              <span>Risk</span>
              <span>AI Command</span>
              <span>Deep Crawl</span>
              <span>Auto Alerts</span>
              <span>Slack</span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-xs uppercase tracking-wider text-white/35">Live Price</div>
            <div className="mt-1 whitespace-nowrap font-mono text-2xl font-semibold text-white sm:text-3xl">
              {selectedStock ? `Rs. ${money(selectedStock.price)}` : 'No Data'}
            </div>
            {selectedStock && (
              <div className={cn('mt-1 font-mono text-sm', up ? 'text-emerald-300' : 'text-red-300')}>
                {up ? '+' : ''}
                {selectedStock.changePct.toFixed(2)}%
              </div>
            )}
          </div>
        </div>
      </div>
      <Metric label="Risk" value={riskReport ? riskReport.overall.level : 'Pending'} icon={Scale} tone={riskReport ? decisionTone[riskReport.overall.decision] : 'default'} />
      <Metric label="Command" value={commandReport ? commandReport.suggestedPlan.stance : 'Pending'} icon={BrainCircuit} tone={commandReport ? stanceTone[commandReport.suggestedPlan.stance] : 'default'} />
      <Metric label="Crawler" value={crawlReport?.predictions[0]?.verdict ?? 'Pending'} icon={Radar} tone={crawlReport?.predictions[0] ? verdictTone[crawlReport.predictions[0].verdict] : 'default'} />
      <Metric label="Alerts" value={activeAlerts.toString()} icon={BellPlus} tone={activeAlerts ? 'info' : 'default'} />
    </div>
  );
}

function MarketCircuitPanel({
  selectedStock,
  bounds,
}: {
  selectedStock: PriceSummary | null;
  bounds: { lower: number; upper: number } | null;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-sky-400/15 bg-sky-400/[0.05] p-4 lg:grid-cols-[minmax(0,1fr)_170px_170px_170px] lg:items-center">
      <div className="min-w-0">
        <PanelTitle icon={ShieldAlert} title="Nepal Daily Circuit Guard" />
        <p className="mt-2 text-sm leading-5 text-white/50">
          Portfolio Bot will keep manual and automatic alert targets inside ±{DAILY_CIRCUIT_LIMIT_PCT}% of the latest known price.
        </p>
      </div>
      <InfoPill label="Reference" value={selectedStock ? `Rs. ${money(selectedStock.price)}` : 'No Price'} tone="info" />
      <InfoPill label="Lower Circuit" value={bounds ? `Rs. ${money(bounds.lower)}` : 'Waiting'} tone="danger" />
      <InfoPill label="Upper Circuit" value={bounds ? `Rs. ${money(bounds.upper)}` : 'Waiting'} tone="success" />
    </div>
  );
}

function PortfolioAnalysisPanel({ report, loading }: { report: PortfolioAnalysisReport | null; loading: boolean }) {
  if (loading && !report) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/15 p-5">
        <div className="flex items-center gap-3 text-sm text-white/45">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading portfolio analysis…
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-black/10 p-5 text-center">
        <PanelTitle icon={WalletCards} title="Actual Portfolio Analysis" />
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-white/45">
          Add your holdings with quantity and average cost, then run analysis. Scheduled analysis uses the same holdings and can send Slack summaries from Settings.
        </p>
      </div>
    );
  }

  const positive = report.unrealizedGain >= 0;
  const statusTone: Tone = report.status === 'HEALTHY' ? 'success' : report.status === 'MONITOR' ? 'warn' : 'danger';

  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <PanelTitle icon={WalletCards} title="Actual Portfolio Analysis" />
            <Badge tone={statusTone}>{report.status}</Badge>
            <Badge tone="default">{report.reason}</Badge>
            {report.notifiedAt && <Badge tone="info">Slack Sent</Badge>}
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-white/60">{report.summary}</p>
          <div className="mt-2 text-xs text-white/35">
            Last run {new Date(report.generatedAt).toLocaleString()} {report.nextRunAt ? `· Next scheduled ${new Date(report.nextRunAt).toLocaleString()}` : ''}
          </div>
        </div>
        <div className="grid min-w-72 grid-cols-2 gap-2">
          <InfoPill label="Value" value={`Rs. ${money(report.currentValue)}`} />
          <InfoPill label="Cost" value={`Rs. ${money(report.totalCost)}`} />
          <InfoPill
            label="P/L"
            value={`${positive ? '+' : ''}Rs. ${money(report.unrealizedGain)}`}
            tone={positive ? 'success' : 'danger'}
          />
          <InfoPill label="Risk" value={`${report.riskScore.toFixed(0)}/100`} tone={statusTone} />
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {report.holdings.map((holding) => {
          const holdingPositive = holding.unrealizedGain >= 0;
          return (
            <div key={holding.id} className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:grid-cols-[minmax(0,1fr)_120px_120px_150px] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-white">{holding.symbol}</span>
                  <Badge tone={holding.decision === 'AVOID' ? 'danger' : holding.decision === 'WAIT' ? 'warn' : 'success'}>{holding.decision.replace('_', ' ')}</Badge>
                  <Badge tone={holding.riskScore >= 65 ? 'danger' : holding.riskScore >= 38 ? 'warn' : 'success'}>{holding.riskLevel}</Badge>
                </div>
                {holding.name && <p className="mt-1 truncate text-xs text-white/35">{holding.name}</p>}
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{holding.action}</p>
                <p className="mt-1 line-clamp-1 text-xs text-sky-200/55">
                  Crawl {holding.crawlerVerdict} · {holding.crawlerNotices} notices · {holding.crawlerSources} sources
                </p>
              </div>
              <InfoPill label="Allocation" value={`${holding.allocationPct.toFixed(2)}%`} />
              <InfoPill label="Risk" value={`${holding.riskScore.toFixed(0)}/100`} />
              <InfoPill
                label="Gain/Loss"
                value={`${holdingPositive ? '+' : ''}${holding.gainPct.toFixed(2)}%`}
                tone={holdingPositive ? 'success' : 'danger'}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionPanel({
  symbol,
  selectedPrice,
  sourceNames,
  selectedWatchlist,
  watched,
  busyAction,
  alertIdeas,
  onAddToWatchlist,
  onCreateAlert,
}: {
  symbol: string;
  selectedPrice: number | null;
  sourceNames: string[];
  selectedWatchlist: Watchlist | null;
  watched: boolean;
  busyAction: string;
  alertIdeas: ({ condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string; source: string })[];
  onAddToWatchlist: () => void;
  onCreateAlert: (idea: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }, source: string) => void;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <PanelTitle icon={Target} title="Portfolio Action Queue" />
          <p className="mt-2 text-sm leading-5 text-white/45">
            Sources: {sourceNames.length ? Array.from(new Set(sourceNames)).join(', ') : 'none selected'}.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={onAddToWatchlist} loading={busyAction === 'watchlist'} disabled={!symbol || !selectedWatchlist || watched}>
          <WalletCards className="h-4 w-4" aria-hidden="true" />
          {watched ? 'In Watchlist' : `Add to ${selectedWatchlist?.name ?? 'Watchlist'}`}
        </Button>
      </div>
      <div className="mt-4 grid gap-3">
        {alertIdeas.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
            Start the bot to generate risk and command alert ideas.
          </div>
        ) : (
          alertIdeas.map((idea) => {
            const key = `${idea.source}-${idea.condition}-${idea.targetPrice}`;
            const allowed = insideCircuit(selectedPrice, idea.targetPrice);
            return (
              <div
                key={key}
                className={cn(
                  'grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
                  allowed ? 'border-white/8 bg-white/[0.03]' : 'border-red-400/20 bg-red-400/[0.06]',
                )}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={idea.source === 'Risk' ? 'warn' : 'info'}>{idea.source}</Badge>
                    <Badge tone={allowed ? 'success' : 'danger'}>{allowed ? 'Inside Circuit' : 'Outside Circuit'}</Badge>
                    <span className="font-mono text-sm font-semibold text-white">
                      {idea.condition} Rs. {money(idea.targetPrice)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{idea.reason}</p>
                </div>
                <Button type="button" size="sm" variant="secondary" loading={busyAction === key} disabled={!allowed} onClick={() => onCreateAlert(idea, idea.source)}>
                  Create Alert
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PortfolioEvidence({
  riskReport,
  commandReport,
  crawlReport,
  comparisonReport,
}: {
  riskReport: PreTradeRiskReport | null;
  commandReport: StockCommandReport | null;
  crawlReport: CrawlPredictionReport | null;
  comparisonReport: CrawlPredictionReport | null;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/15 p-4">
      <PanelTitle icon={Sparkles} title="Bot Intelligence Summary" />
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <EvidenceTile
          icon={ShieldAlert}
          title="Pre-Trade Risk"
          badge={riskReport ? riskReport.overall.decision.replace('_', ' ') : 'Pending'}
          tone={riskReport ? decisionTone[riskReport.overall.decision] : 'default'}
          body={riskReport?.overall.summary ?? 'Run the bot to see downside, liquidity, sector, notice, and exit difficulty.'}
        />
        <EvidenceTile
          icon={BrainCircuit}
          title="AI Command"
          badge={commandReport?.suggestedPlan.stance ?? 'Pending'}
          tone={commandReport ? stanceTone[commandReport.suggestedPlan.stance] : 'default'}
          body={commandReport?.suggestedPlan.summary ?? 'Run the bot to explain why the stock may be moving.'}
        />
        <EvidenceTile
          icon={Globe2}
          title="Crawler Prediction"
          badge={crawlReport?.predictions[0]?.verdict ?? 'Pending'}
          tone={crawlReport?.predictions[0] ? verdictTone[crawlReport.predictions[0].verdict] : 'default'}
          body={crawlReport?.summary ?? 'Run the bot to crawl notices and news from selected websites.'}
        />
        <EvidenceTile
          icon={GitCompareArrows}
          title="Comparison"
          badge={comparisonReport?.winner ? `Winner ${comparisonReport.winner}` : 'Optional'}
          tone={comparisonReport?.winner ? 'success' : 'default'}
          body={comparisonReport?.summary ?? 'Select another stock to compare the current candidate against.'}
        />
      </div>

      {commandReport?.whyMoving.length ? (
        <div className="mt-4 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-100/70">Why This Stock Is Moving</div>
          <div className="grid gap-2">
            {commandReport.whyMoving.slice(0, 4).map((reason) => (
              <div key={reason} className="flex gap-2 text-sm leading-5 text-emerald-50/75">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EvidenceTile({
  icon: Icon,
  title,
  badge,
  tone,
  body,
}: {
  icon: ElementType;
  title: string;
  badge: string;
  tone: Tone;
  body: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-sky-300" aria-hidden="true" />
          <span className="truncate text-sm font-semibold text-white">{title}</span>
        </div>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <p className="line-clamp-3 text-sm leading-5 text-white/55">{body}</p>
    </div>
  );
}

function StepRow({ step, index }: { step: MissionStep; index: number }) {
  const tone =
    step.status === 'done'
      ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
      : step.status === 'running'
        ? 'border-sky-400/25 bg-sky-400/10 text-sky-200'
        : step.status === 'error'
          ? 'border-red-400/25 bg-red-400/10 text-red-200'
          : 'border-white/10 bg-white/[0.03] text-white/45';
  return (
    <div className={cn('grid gap-3 rounded-lg border p-3 sm:grid-cols-[36px_minmax(0,1fr)_70px]', tone)}>
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/20 font-mono text-xs font-bold">
        {step.status === 'running' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : index + 1}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{step.label}</div>
        <p className="line-clamp-2 text-xs leading-5 text-current/75">{step.detail}</p>
      </div>
      <div className="font-mono text-xs text-current/70 sm:text-right">
        {step.durationMs ? `${step.durationMs}ms` : step.status}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: ElementType;
  tone: Tone;
}) {
  return (
    <div className="min-h-[116px] rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-wider text-white/35">{label}</span>
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            tone === 'success' ? 'text-emerald-300' : tone === 'danger' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'info' ? 'text-sky-300' : 'text-white/35',
          )}
          aria-hidden="true"
        />
      </div>
      <div className="truncate font-mono text-lg font-semibold tabular-nums text-white sm:text-xl">{value}</div>
    </div>
  );
}

function InfoPill({ label, value, tone = 'default' }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="truncate text-[10px] uppercase tracking-wider text-white/35">{label}</div>
      <div
        className={cn(
          'mt-1 truncate font-mono text-sm font-semibold tabular-nums',
          tone === 'success' ? 'text-emerald-300' : tone === 'danger' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : tone === 'info' ? 'text-sky-300' : 'text-white',
        )}
      >
        {value}
      </div>
    </div>
  );
}

function PanelTitle({ icon: Icon, title }: { icon: ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-sky-300" aria-hidden="true" />
      <h4 className="text-sm font-semibold text-white">{title}</h4>
    </div>
  );
}
