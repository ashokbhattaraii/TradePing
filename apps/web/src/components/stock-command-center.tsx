'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import {
  AlertTriangle,
  BarChart3,
  BellPlus,
  BrainCircuit,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Loader2,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AlertCondition, StockSymbol } from '@tradeping/types';
import { api, type PriceSummary, type StockCommandReport } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Select } from './ui/input';
import { useToast } from './ui/toast';

type Tone = 'success' | 'info' | 'warn' | 'danger' | 'default';

function money(value: number) {
  return new Intl.NumberFormat('en-NP', { maximumFractionDigits: 2 }).format(value);
}

function compact(value: number) {
  return new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function stockLabel(stock: PriceSummary) {
  return stock.name && stock.name !== stock.symbol ? `${stock.symbol} - ${stock.name}` : stock.symbol;
}

const riskTone: Record<StockCommandReport['risk']['level'], Tone> = {
  LOW: 'success',
  MODERATE: 'warn',
  HIGH: 'danger',
  EXTREME: 'danger',
};

const stanceTone: Record<StockCommandReport['suggestedPlan']['stance'], Tone> = {
  WATCH: 'info',
  ALERT: 'success',
  AVOID: 'danger',
  REVIEW: 'warn',
};

export function StockCommandCenter({
  stocks,
  onAlertCreated,
}: {
  stocks: PriceSummary[];
  onAlertCreated?: () => void;
}) {
  const { push } = useToast();
  const stockOptions = useMemo(() => [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)), [stocks]);
  const [symbol, setSymbol] = useState('');
  const [report, setReport] = useState<StockCommandReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState<string | null>(null);
  const selectedPrice = stockOptions.find((stock) => stock.symbol === symbol) ?? null;

  useEffect(() => {
    if (!symbol && stockOptions[0]) setSymbol(stockOptions[0].symbol);
  }, [stockOptions, symbol]);

  const runAnalysis = async () => {
    if (!symbol) {
      push('error', 'Select a stock before running the command report.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.stockCommand(symbol);
      setReport(res.data);
      push('success', `AI command report ready for ${res.data.symbol}`);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to generate stock command report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (symbol && !report && stockOptions.length > 0) void runAnalysis();
    // Run once when the first symbol becomes available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, stockOptions.length]);

  const createSuggestedAlert = async (idea: StockCommandReport['suggestedPlan']['alertIdeas'][number]) => {
    if (!report) return;
    const key = `${idea.condition}-${idea.targetPrice}`;
    setCreatingAlert(key);
    try {
      await api.createAlert({
        symbol: report.symbol as StockSymbol,
        condition: idea.condition as AlertCondition,
        targetPrice: idea.targetPrice,
        priority: report.risk.level === 'HIGH' || report.risk.level === 'EXTREME' ? 'HIGH' : 'MEDIUM',
        note: `AI Command Center: ${idea.reason}`,
      });
      push('success', `${report.symbol} ${idea.condition} alert created`);
      onAlertCreated?.();
    } catch (err) {
      push('error', (err as Error).message || 'Failed to create suggested alert.');
    } finally {
      setCreatingAlert(null);
    }
  };

  return (
    <section className="grid gap-5">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10">
                <BrainCircuit className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white text-balance">AI Stock Command Center</h3>
                <p className="truncate text-sm text-white/45">
                  Live price, notices, broker activity, sector context, risk, confidence, and a suggested alert plan.
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(220px,320px)_auto]">
              <label className="block">
                <span className="sr-only">Select Stock</span>
                <Select
                  name="commandStock"
                  aria-label="Select stock for AI command report"
                  value={symbol}
                  onChange={(event) => {
                    setSymbol(event.target.value);
                    setReport(null);
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
              <Button type="button" variant="secondary" onClick={runAnalysis} loading={loading} disabled={!symbol}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Analyze
              </Button>
            </div>
          </div>
        </div>

        {!report ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.04]">
              {loading ? <Loader2 className="h-5 w-5 animate-spin text-white/45" aria-hidden="true" /> : <Gauge className="h-5 w-5 text-white/35" aria-hidden="true" />}
            </div>
            <p className="mt-4 max-w-lg text-sm text-white/45">
              {selectedPrice
                ? `Ready to analyze ${stockLabel(selectedPrice)}.`
                : 'Waiting for the crawler to load available stocks…'}
            </p>
          </div>
        ) : (
          <CommandReport report={report} onCreateAlert={createSuggestedAlert} creatingAlert={creatingAlert} />
        )}
      </Card>
    </section>
  );
}

function CommandReport({
  report,
  onCreateAlert,
  creatingAlert,
}: {
  report: StockCommandReport;
  onCreateAlert: (idea: StockCommandReport['suggestedPlan']['alertIdeas'][number]) => void;
  creatingAlert: string | null;
}) {
  const price = report.price;
  const up = (price?.change ?? 0) >= 0;

  return (
    <div className="grid gap-5 p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-white/10 bg-black/20 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-mono text-3xl font-bold text-white">{report.symbol}</h3>
                <Badge tone={stanceTone[report.suggestedPlan.stance]}>{report.suggestedPlan.stance}</Badge>
                <Badge tone={riskTone[report.risk.level]}>{report.risk.level} Risk</Badge>
                <Badge tone={report.confidence.label === 'HIGH' ? 'success' : report.confidence.label === 'MEDIUM' ? 'info' : 'warn'}>
                  {report.confidence.score}% Confidence
                </Badge>
              </div>
              {report.name && report.name !== report.symbol && (
                <p className="mt-1 truncate text-sm text-white/50">{report.name}</p>
              )}
              <p className="mt-4 max-w-2xl text-sm leading-6 text-white/65">{report.suggestedPlan.summary}</p>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xs uppercase tracking-wider text-white/35">Live Price</div>
              <div className="mt-1 font-mono text-3xl font-semibold text-white">
                {price ? `Rs. ${money(price.price)}` : 'No Data'}
              </div>
              {price && (
                <div className={cn('mt-1 flex items-center gap-1 font-mono text-sm sm:justify-end', up ? 'text-emerald-300' : 'text-red-300')}>
                  {up ? <TrendingUp className="h-4 w-4" aria-hidden="true" /> : <TrendingDown className="h-4 w-4" aria-hidden="true" />}
                  {up ? '+' : ''}
                  {price.changePct.toFixed(2)}%
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Metric label="Risk Score" value={`${report.risk.score}/100`} icon={ShieldAlert} tone={riskTone[report.risk.level]} />
          <Metric label="Evidence" value={report.confidence.label} icon={CheckCircle2} tone={report.confidence.label === 'HIGH' ? 'success' : 'info'} />
          <Metric label="Sector Rank" value={report.sectorComparison.rankByChange ? `#${report.sectorComparison.rankByChange}` : '—'} icon={BarChart3} tone="default" />
          <Metric label="Broker Rows" value={report.brokerActivity.trades.toString()} icon={Users} tone={report.brokerActivity.status === 'live' ? 'success' : 'warn'} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <Card className="p-5">
          <SectionTitle icon={BrainCircuit} title="Why This Stock Is Moving" />
          <div className="mt-4 grid gap-3">
            {report.whyMoving.map((reason) => (
              <div key={reason} className="flex gap-3 rounded-lg border border-white/8 bg-white/[0.03] p-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <p className="text-sm leading-5 text-white/65">{reason}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={AlertTriangle} title="Risk & Accuracy Controls" />
          <div className="mt-4 grid gap-3">
            {report.risk.factors.map((factor) => (
              <p key={factor} className="rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-sm text-white/60">
                {factor}
              </p>
            ))}
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100/80">
              Evidence used: {report.confidence.coverage.length ? report.confidence.coverage.join(', ') : 'limited crawler evidence'}.
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5">
          <SectionTitle icon={Gauge} title="Live Movement" />
          <div className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Direction" value={report.movement.direction.toUpperCase()} />
            <InfoRow label="Day Range" value={`${report.movement.dayRangePct.toFixed(2)}%`} />
            <InfoRow label="History Samples" value={report.movement.samples.toString()} />
            <InfoRow label="Volume" value={price ? compact(price.volume) : '—'} />
            <InfoRow label="Turnover" value={price ? `Rs. ${compact(price.turnover)}` : '—'} />
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={BarChart3} title="Sector Comparison" />
          <div className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Sector" value={report.sectorComparison.sector} />
            <InfoRow label="Peers" value={report.sectorComparison.peers.toString()} />
            <InfoRow label="Sector Avg" value={`${report.sectorComparison.sectorAverageChangePct.toFixed(2)}%`} />
            <InfoRow label="Turnover Rank" value={report.sectorComparison.rankByTurnover ? `#${report.sectorComparison.rankByTurnover}` : '—'} />
          </div>
          <div className="mt-4 space-y-2">
            {report.sectorComparison.leaders.slice(0, 3).map((leader) => (
              <div key={leader.symbol} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="min-w-0">
                  <span className="block font-mono text-xs font-semibold text-white">{leader.symbol}</span>
                  {leader.name && <span className="block truncate text-[11px] text-white/35">{leader.name}</span>}
                </span>
                <span className={cn('font-mono text-xs', leader.changePct >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                  {leader.changePct >= 0 ? '+' : ''}
                  {leader.changePct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={Users} title="Broker Activity" />
          <p className="mt-4 text-sm leading-5 text-white/60">{report.brokerActivity.summary}</p>
          <div className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Status" value={report.brokerActivity.status.toUpperCase()} />
            <InfoRow label="Quantity" value={compact(report.brokerActivity.totalQuantity)} />
            <InfoRow label="Amount" value={`Rs. ${compact(report.brokerActivity.totalAmount)}`} />
            <InfoRow label="Avg Rate" value={`Rs. ${money(report.brokerActivity.averageRate)}`} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5">
          <SectionTitle icon={Newspaper} title="Notices & News Summary" />
          <div className="mt-4 grid gap-3">
            {report.notices.length === 0 ? (
              <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
                No symbol-specific notice was found in the crawled sources.
              </div>
            ) : (
              report.notices.map((notice) => (
                <a
                  key={`${notice.source}-${notice.title}`}
                  href={notice.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-white/8 bg-white/[0.03] p-3 transition-[background-color,border-color,color] hover:border-sky-400/30 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={notice.sentiment === 'positive' ? 'success' : notice.sentiment === 'negative' ? 'danger' : 'default'}>
                          {notice.sentiment}
                        </Badge>
                        <span className="text-xs text-white/35">{notice.source}</span>
                      </div>
                      <p className="text-sm font-medium leading-5 text-white/75">{notice.title}</p>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-white/30" aria-hidden="true" />
                  </div>
                </a>
              ))
            )}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={BellPlus} title="Suggested Watch / Alert Plan" />
          <p className="mt-4 text-sm leading-5 text-white/60">{report.suggestedPlan.summary}</p>
          <div className="mt-4 grid gap-3">
            {report.suggestedPlan.alertIdeas.map((idea) => {
              const key = `${idea.condition}-${idea.targetPrice}`;
              return (
                <div key={key} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-sm font-semibold text-white">
                        {idea.condition} Rs. {money(idea.targetPrice)}
                      </div>
                      <p className="mt-1 text-xs leading-5 text-white/45">{idea.reason}</p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" loading={creatingAlert === key} onClick={() => onCreateAlert(idea)}>
                      Create
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
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
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-wider text-white/35">{label}</span>
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            tone === 'success' ? 'text-emerald-300' : tone === 'danger' ? 'text-red-300' : tone === 'warn' ? 'text-amber-300' : 'text-white/35',
          )}
          aria-hidden="true"
        />
      </div>
      <div className="truncate font-mono text-xl font-semibold tabular-nums text-white">{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-emerald-300" aria-hidden="true" />
      <h4 className="text-sm font-semibold text-white">{title}</h4>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
      <span className="text-white/40">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-white/75">{value}</span>
    </div>
  );
}
