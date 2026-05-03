'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import type { AlertCondition, StockSymbol } from '@tradeping/types';
import {
  AlertTriangle,
  Banknote,
  BellPlus,
  CheckCircle2,
  Clock3,
  GitCompareArrows,
  Loader2,
  Scale,
  ShieldAlert,
  TrendingDown,
  Users,
} from 'lucide-react';
import { api, type PreTradeRiskReport, type PriceSummary } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input, Select } from './ui/input';
import { useToast } from './ui/toast';

type Tone = 'success' | 'info' | 'warn' | 'danger' | 'default';
type TradeScenario = { id: string; label: string; amount: string; holdingDays: string };
type ScenarioReport = { scenario: TradeScenario; report: PreTradeRiskReport };

const levelTone: Record<'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME', Tone> = {
  LOW: 'success',
  MODERATE: 'warn',
  HIGH: 'danger',
  EXTREME: 'danger',
};

const decisionTone: Record<PreTradeRiskReport['overall']['decision'], Tone> = {
  PASS: 'success',
  SMALL_POSITION: 'info',
  WAIT: 'warn',
  AVOID: 'danger',
};

function money(value: number) {
  return new Intl.NumberFormat('en-NP', { maximumFractionDigits: 2 }).format(value);
}

function compact(value: number) {
  return new Intl.NumberFormat('en-NP', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function stockLabel(stock: PriceSummary) {
  return stock.name && stock.name !== stock.symbol ? `${stock.symbol} - ${stock.name}` : stock.symbol;
}

function scenarioScore(report: PreTradeRiskReport) {
  const stressLoss = report.downsideScenarios.find((scenario) => scenario.label === 'Stress Exit')?.lossPct ?? 0;
  return (
    report.overall.score +
    report.liquidityRisk.score * 0.45 +
    report.liquidityRisk.estimatedExitDays * 2 +
    stressLoss * 1.5
  );
}

export function PreTradeRiskSimulator({
  stocks,
  onAlertCreated,
}: {
  stocks: PriceSummary[];
  onAlertCreated?: () => void;
}) {
  const { push } = useToast();
  const stockOptions = useMemo(() => [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol)), [stocks]);
  const [symbol, setSymbol] = useState('');
  const [scenarios, setScenarios] = useState<TradeScenario[]>([
    { id: 'starter', label: 'Starter', amount: '50000', holdingDays: '3' },
    { id: 'planned', label: 'Planned', amount: '100000', holdingDays: '7' },
    { id: 'stretch', label: 'Stretch', amount: '150000', holdingDays: '14' },
  ]);
  const [scenarioReports, setScenarioReports] = useState<ScenarioReport[]>([]);
  const [activeScenarioId, setActiveScenarioId] = useState('planned');
  const [report, setReport] = useState<PreTradeRiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol && stockOptions[0]) setSymbol(stockOptions[0].symbol);
  }, [stockOptions, symbol]);

  const simulate = async () => {
    if (!symbol) {
      push('error', 'Select a stock before simulating risk.');
      return;
    }
    const validScenarios = scenarios.map((scenario) => ({
      ...scenario,
      numericAmount: Number(scenario.amount),
      numericHoldingDays: Number(scenario.holdingDays),
    }));
    if (validScenarios.some((scenario) => !Number.isFinite(scenario.numericAmount) || scenario.numericAmount <= 0)) {
      push('error', 'Each scenario needs an investment amount greater than zero.');
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.all(
        validScenarios.map(async (scenario) => {
          const res = await api.preTradeRisk({
            symbol,
            amount: scenario.numericAmount,
            holdingDays: Number.isFinite(scenario.numericHoldingDays) ? scenario.numericHoldingDays : 7,
          });
          return { scenario, report: res.data };
        }),
      );
      const ranked = [...results].sort((a, b) => scenarioScore(a.report) - scenarioScore(b.report));
      const preferred = ranked[0] ?? results[0];
      setScenarioReports(results);
      setActiveScenarioId(preferred?.scenario.id ?? 'planned');
      setReport(preferred?.report ?? null);
      push('success', `Compared ${results.length} pre-trade scenarios for ${symbol}`);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to simulate pre-trade risk.');
    } finally {
      setLoading(false);
    }
  };

  const updateScenario = (id: string, patch: Partial<TradeScenario>) => {
    setScenarios((prev) => prev.map((scenario) => (scenario.id === id ? { ...scenario, ...patch } : scenario)));
    setScenarioReports([]);
    setReport(null);
  };

  const createAlert = async (idea: PreTradeRiskReport['alertPlan'][number]) => {
    if (!report) return;
    const key = `${idea.condition}-${idea.targetPrice}`;
    setCreatingAlert(key);
    try {
      await api.createAlert({
        symbol: report.symbol as StockSymbol,
        condition: idea.condition as AlertCondition,
        targetPrice: idea.targetPrice,
        priority: report.overall.level === 'HIGH' || report.overall.level === 'EXTREME' ? 'HIGH' : 'MEDIUM',
        note: `Pre-Trade Simulator: ${idea.reason}`,
      });
      push('success', `${report.symbol} ${idea.condition} alert created`);
      onAlertCreated?.();
    } catch (err) {
      push('error', (err as Error).message || 'Failed to create alert.');
    } finally {
      setCreatingAlert(null);
    }
  };

  return (
    <section className="grid gap-5">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-white/10 bg-white/[0.03] px-5 py-4">
          <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-400/10">
                <Scale className="h-5 w-5 text-amber-300" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-white text-balance">Pre-Trade Risk Simulator</h3>
                <p className="truncate text-sm text-white/45">
                  Test downside, liquidity, exit difficulty, sector risk, notice risk, and alerts before buying.
                </p>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(220px,340px)_auto]">
              <label className="block">
                <span className="sr-only">Select stock</span>
                <Select
                  name="preTradeStock"
                  aria-label="Select stock for pre-trade risk simulation"
                  value={symbol}
                  onChange={(event) => {
                    setSymbol(event.target.value);
                    setScenarioReports([]);
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
              <Button type="button" variant="secondary" onClick={simulate} loading={loading} disabled={!symbol}>
                <GitCompareArrows className="h-4 w-4" aria-hidden="true" />
                Compare 3
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-white/10 bg-black/10 p-5 lg:grid-cols-3">
          {scenarios.map((scenario, index) => (
            <div key={scenario.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">{scenario.label}</div>
                  <div className="text-xs text-white/35">Iteration {index + 1}</div>
                </div>
                <Badge tone={scenario.id === activeScenarioId ? 'success' : 'default'}>{scenario.id}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Amount</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={scenario.amount}
                    onChange={(event) => updateScenario(scenario.id, { amount: event.target.value })}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Days</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={365}
                    value={scenario.holdingDays}
                    onChange={(event) => updateScenario(scenario.id, { holdingDays: event.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        {!report ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.04]">
              {loading ? <Loader2 className="h-5 w-5 animate-spin text-white/45" aria-hidden="true" /> : <ShieldAlert className="h-5 w-5 text-white/35" aria-hidden="true" />}
            </div>
            <p className="mt-4 max-w-xl text-sm text-white/45">
              Run the three iterations to compare starter, planned, and stretch positions before buying.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 p-5">
            {scenarioReports.length > 0 && (
              <ScenarioComparison
                reports={scenarioReports}
                activeScenarioId={activeScenarioId}
                onSelect={(item) => {
                  setActiveScenarioId(item.scenario.id);
                  setReport(item.report);
                }}
              />
            )}
            <RiskReport
              report={report}
              onCreateAlert={createAlert}
              creatingAlert={creatingAlert}
              scenarioLabel={scenarioReports.find((item) => item.scenario.id === activeScenarioId)?.scenario.label}
            />
          </div>
        )}
      </Card>
    </section>
  );
}

function ScenarioComparison({
  reports,
  activeScenarioId,
  onSelect,
}: {
  reports: ScenarioReport[];
  activeScenarioId: string;
  onSelect: (item: ScenarioReport) => void;
}) {
  const ranked = [...reports].sort((a, b) => scenarioScore(a.report) - scenarioScore(b.report));
  const best = ranked[0];
  const worstStressLoss = Math.max(
    ...reports.map((item) => item.report.downsideScenarios.find((scenario) => scenario.label === 'Stress Exit')?.estimatedLoss ?? 0),
  );

  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <SectionTitle icon={GitCompareArrows} title="3-Iteration Comparison" />
          <p className="mt-2 text-sm text-white/45">
            {best ? `${best.scenario.label} is currently the cleanest version by blended risk, exit pressure, and stress loss.` : 'Run the scenarios to rank trade plans.'}
          </p>
        </div>
        <div className="rounded-lg border border-red-400/15 bg-red-400/[0.04] px-3 py-2 text-right">
          <div className="text-xs uppercase tracking-wider text-red-200/50">Worst Stress Loss</div>
          <div className="font-mono text-lg font-semibold text-red-200">Rs. {money(worstStressLoss)}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {reports.map((item) => {
          const active = item.scenario.id === activeScenarioId;
          const stress = item.report.downsideScenarios.find((scenario) => scenario.label === 'Stress Exit');
          const score = Math.round(scenarioScore(item.report));
          return (
            <button
              key={item.scenario.id}
              type="button"
              onClick={() => onSelect(item)}
              className={cn(
                'rounded-lg border p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                active ? 'border-amber-400/45 bg-amber-400/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-white">{item.scenario.label}</span>
                  <span className="block text-xs text-white/35">
                    Rs. {money(item.report.input.amount)} for {item.report.input.holdingDays}d
                  </span>
                </span>
                <Badge tone={decisionTone[item.report.overall.decision]}>{item.report.overall.decision.replace('_', ' ')}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoRow label="Risk" value={`${item.report.overall.score}/100`} />
                <InfoRow label="Blend" value={score.toString()} />
                <InfoRow label="Exit" value={item.report.liquidityRisk.estimatedExitDays > 30 ? '30+' : `${item.report.liquidityRisk.estimatedExitDays}d`} />
                <InfoRow label="Stress" value={stress ? `Rs. ${compact(stress.estimatedLoss)}` : '—'} />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function RiskReport({
  report,
  onCreateAlert,
  creatingAlert,
  scenarioLabel,
}: {
  report: PreTradeRiskReport;
  onCreateAlert: (idea: PreTradeRiskReport['alertPlan'][number]) => void;
  creatingAlert: string | null;
  scenarioLabel?: string;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-white/10 bg-black/20 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-mono text-3xl font-bold text-white">{report.symbol}</h3>
                {scenarioLabel && <Badge tone="default">{scenarioLabel}</Badge>}
                <Badge tone={decisionTone[report.overall.decision]}>{report.overall.decision.replace('_', ' ')}</Badge>
                <Badge tone={levelTone[report.overall.level]}>{report.overall.level} Risk</Badge>
                <Badge tone="default">Score {report.overall.score}/100</Badge>
              </div>
              {report.name && report.name !== report.symbol && <p className="mt-1 truncate text-sm text-white/50">{report.name}</p>}
              <p className="mt-4 max-w-3xl text-sm leading-6 text-white/65">{report.overall.summary}</p>
            </div>
            <div className="grid min-w-52 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <InfoRow label="Amount" value={`Rs. ${money(report.input.amount)}`} />
              <InfoRow label="Units" value={report.estimatedUnits.toString()} />
              <InfoRow label="Est. Cost" value={`Rs. ${money(report.estimatedCost)}`} />
              <InfoRow label="Holding" value={`${report.input.holdingDays} days`} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Metric label="Liquidity" value={report.liquidityRisk.level} icon={Users} tone={levelTone[report.liquidityRisk.level]} />
          <Metric label="Exit Days" value={report.liquidityRisk.estimatedExitDays > 30 ? '30+' : report.liquidityRisk.estimatedExitDays.toString()} icon={Clock3} tone={report.liquidityRisk.estimatedExitDays > 2 ? 'warn' : 'success'} />
          <Metric label="Sector" value={report.sectorRisk.level} icon={TrendingDown} tone={report.sectorRisk.level === 'LOW' ? 'success' : report.sectorRisk.level === 'MODERATE' ? 'warn' : 'danger'} />
          <Metric label="Notice" value={report.noticeRisk.level} icon={AlertTriangle} tone={report.noticeRisk.level === 'LOW' ? 'success' : report.noticeRisk.level === 'MODERATE' ? 'warn' : 'danger'} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="p-5">
          <SectionTitle icon={TrendingDown} title="Downside Scenarios" />
          <div className="mt-4 grid gap-3">
            {report.downsideScenarios.map((scenario) => (
              <div key={scenario.label} className="rounded-lg border border-red-400/10 bg-red-400/[0.04] p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-white">{scenario.label}</span>
                  <span className="font-mono text-sm text-red-300">{scenario.movePct.toFixed(2)}%</span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-white/45">
                  <InfoRow label="Est. Price" value={`Rs. ${money(scenario.estimatedPrice)}`} />
                  <InfoRow label="Est. Loss" value={`Rs. ${money(scenario.estimatedLoss)}`} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={Users} title="Liquidity & Exit" />
          <div className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Turnover Used" value={`${report.liquidityRisk.dailyTurnoverCoveragePct.toFixed(2)}%`} />
            <InfoRow label="Volume Used" value={`${report.liquidityRisk.volumeParticipationPct.toFixed(2)}%`} />
            <InfoRow label="Comfort Size" value={`Rs. ${compact(report.liquidityRisk.maxComfortablePosition)}`} />
          </div>
          <div className="mt-4 grid gap-2">
            {report.liquidityRisk.reasons.map((reason) => (
              <Reason key={reason} text={reason} />
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={Banknote} title="Sector & Notice Risk" />
          <div className="mt-4 grid gap-3 text-sm">
            <InfoRow label="Sector Gap" value={`${report.sectorRisk.relativePerformancePct >= 0 ? '+' : ''}${report.sectorRisk.relativePerformancePct.toFixed(2)}%`} />
            <InfoRow label="Sector Rank" value={report.sectorRisk.rankByChange ? `#${report.sectorRisk.rankByChange}/${report.sectorRisk.peers}` : '—'} />
            <InfoRow label="Positive News" value={report.noticeRisk.positive.toString()} />
            <InfoRow label="Negative News" value={report.noticeRisk.negative.toString()} />
          </div>
          <p className="mt-4 text-sm leading-5 text-white/60">{report.sectorRisk.summary}</p>
          <p className="mt-2 text-sm leading-5 text-white/60">{report.noticeRisk.summary}</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="p-5">
          <SectionTitle icon={CheckCircle2} title="Evidence & Assumptions" />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/10 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-100/70">Evidence Used</div>
              <ul className="space-y-2 text-sm text-emerald-50/75">
                {report.evidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/35">Assumptions</div>
              <ul className="space-y-2 text-sm text-white/60">
                {report.assumptions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle icon={BellPlus} title="Pre-Trade Alert Plan" />
          <div className="mt-4 grid gap-3">
            {report.alertPlan.map((idea) => {
              const key = `${idea.condition}-${idea.targetPrice}`;
              return (
                <div key={key} className="rounded-lg border border-white/8 bg-white/[0.03] p-3">
                  <div className="font-mono text-sm font-semibold text-white">
                    {idea.condition} Rs. {money(idea.targetPrice)}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-white/45">{idea.reason}</p>
                  <Button type="button" size="sm" variant="secondary" loading={creatingAlert === key} onClick={() => onCreateAlert(idea)} className="mt-3">
                    Create Alert
                  </Button>
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
      <div className="truncate font-mono text-xl font-semibold text-white">{value}</div>
    </div>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-amber-300" aria-hidden="true" />
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

function Reason({ text }: { text: string }) {
  return (
    <div className="flex gap-2 rounded-lg border border-white/8 bg-white/[0.03] p-3">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
      <p className="text-sm leading-5 text-white/65">{text}</p>
    </div>
  );
}
