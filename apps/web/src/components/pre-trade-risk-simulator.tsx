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
type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
type Decision = PreTradeRiskReport['overall']['decision'];
type AnalysisIteration = {
  id: 'base' | 'liquidity' | 'stress';
  label: string;
  focus: string;
  decision: Decision;
  level: RiskLevel;
  score: number;
  estimatedLoss: number;
  lossPct: number;
  exitDays: number;
  summary: string;
  checks: string[];
};

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

function levelFromScore(score: number): RiskLevel {
  if (score >= 82) return 'EXTREME';
  if (score >= 62) return 'HIGH';
  if (score >= 38) return 'MODERATE';
  return 'LOW';
}

function decisionFromScore(score: number, hasNegativeNotice = false): Decision {
  if (score >= 82 || (score >= 62 && hasNegativeNotice)) return 'AVOID';
  if (score >= 62) return 'WAIT';
  if (score >= 38) return 'SMALL_POSITION';
  return 'PASS';
}

function scenarioByLabel(report: PreTradeRiskReport, label: string) {
  return report.downsideScenarios.find((scenario) => scenario.label === label) ?? report.downsideScenarios[0];
}

function buildAnalysisIterations(report: PreTradeRiskReport): AnalysisIteration[] {
  const normal = scenarioByLabel(report, 'Normal Pullback');
  const volatile = scenarioByLabel(report, 'Volatile Session');
  const stress = scenarioByLabel(report, 'Stress Exit');
  const negativeNotice = report.noticeRisk.negative > 0;
  const liquidityScore = Math.min(
    100,
    Math.round(report.overall.score * 0.5 + report.liquidityRisk.score * 0.42 + report.liquidityRisk.estimatedExitDays * 2),
  );
  const stressScore = Math.min(
    100,
    Math.round(
      Math.max(report.overall.score, report.liquidityRisk.score) +
        (stress?.lossPct ?? 0) * 1.2 +
        (negativeNotice ? 8 : 0),
    ),
  );

  return [
    {
      id: 'base',
      label: 'Iteration 1',
      focus: 'Base evidence',
      decision: report.overall.decision,
      level: report.overall.level,
      score: report.overall.score,
      estimatedLoss: normal?.estimatedLoss ?? 0,
      lossPct: normal?.lossPct ?? 0,
      exitDays: report.liquidityRisk.estimatedExitDays,
      summary: 'Uses the normal pullback band with the current price, sector, notice, and liquidity evidence.',
      checks: [
        `Current decision: ${report.overall.decision.replace('_', ' ')}`,
        `Normal downside: ${normal?.lossPct.toFixed(2) ?? '0.00'}%`,
        `Evidence: ${report.evidence.join(', ')}`,
      ],
    },
    {
      id: 'liquidity',
      label: 'Iteration 2',
      focus: 'Liquidity adjusted',
      decision: decisionFromScore(liquidityScore, negativeNotice),
      level: levelFromScore(liquidityScore),
      score: liquidityScore,
      estimatedLoss: volatile?.estimatedLoss ?? normal?.estimatedLoss ?? 0,
      lossPct: volatile?.lossPct ?? normal?.lossPct ?? 0,
      exitDays: report.liquidityRisk.estimatedExitDays,
      summary: 'Re-weights the same trade toward turnover usage, volume participation, and estimated exit days.',
      checks: [
        `Turnover used: ${report.liquidityRisk.dailyTurnoverCoveragePct.toFixed(2)}%`,
        `Volume used: ${report.liquidityRisk.volumeParticipationPct.toFixed(2)}%`,
        `Estimated exit: ${report.liquidityRisk.estimatedExitDays} session${report.liquidityRisk.estimatedExitDays === 1 ? '' : 's'}`,
      ],
    },
    {
      id: 'stress',
      label: 'Iteration 3',
      focus: 'Stress confirmation',
      decision: decisionFromScore(stressScore, negativeNotice),
      level: levelFromScore(stressScore),
      score: stressScore,
      estimatedLoss: stress?.estimatedLoss ?? volatile?.estimatedLoss ?? 0,
      lossPct: stress?.lossPct ?? volatile?.lossPct ?? 0,
      exitDays: report.liquidityRisk.estimatedExitDays > 30 ? 30 : Math.max(report.liquidityRisk.estimatedExitDays, 1),
      summary: 'Uses the stress-exit band and penalizes weak notices or difficult liquidity to test the worst acceptable case.',
      checks: [
        `Stress downside: ${stress?.lossPct.toFixed(2) ?? '0.00'}%`,
        `Notice risk: ${report.noticeRisk.level}`,
        `Sector risk: ${report.sectorRisk.level}`,
      ],
    },
  ];
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
  const [amount, setAmount] = useState('100000');
  const [holdingDays, setHoldingDays] = useState('7');
  const [activeIterationId, setActiveIterationId] = useState<AnalysisIteration['id']>('base');
  const [report, setReport] = useState<PreTradeRiskReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingAlert, setCreatingAlert] = useState<string | null>(null);
  const iterations = useMemo(() => (report ? buildAnalysisIterations(report) : []), [report]);
  const activeIteration = iterations.find((iteration) => iteration.id === activeIterationId) ?? iterations[0];

  useEffect(() => {
    if (!symbol && stockOptions[0]) setSymbol(stockOptions[0].symbol);
  }, [stockOptions, symbol]);

  const simulate = async () => {
    if (!symbol) {
      push('error', 'Select a stock before simulating risk.');
      return;
    }
    const numericAmount = Number(amount);
    const numericHoldingDays = Number(holdingDays);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      push('error', 'Enter an investment amount greater than zero.');
      return;
    }
    setLoading(true);
    try {
      const res = await api.preTradeRisk({
        symbol,
        amount: numericAmount,
        holdingDays: Number.isFinite(numericHoldingDays) ? numericHoldingDays : 7,
      });
      setReport(res.data);
      setActiveIterationId('base');
      push('success', `Generated 3 analysis iterations for ${res.data.symbol}`);
    } catch (err) {
      push('error', (err as Error).message || 'Failed to simulate pre-trade risk.');
    } finally {
      setLoading(false);
    }
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
                Run 3 Iterations
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-white/10 bg-black/10 p-5 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-sm font-semibold text-white">Same Trade Setup</div>
            <p className="mt-1 text-xs leading-5 text-white/40">
              One stock, one amount, one holding period. The app runs three analysis passes against the same setup.
            </p>
          </div>
          <label className="block rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Amount</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setReport(null);
              }}
            />
          </label>
          <label className="block rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-white/35">Holding Days</span>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              value={holdingDays}
              onChange={(event) => {
                setHoldingDays(event.target.value);
                setReport(null);
              }}
            />
          </label>
        </div>

        {!report ? (
          <div className="grid place-items-center px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.04]">
              {loading ? <Loader2 className="h-5 w-5 animate-spin text-white/45" aria-hidden="true" /> : <ShieldAlert className="h-5 w-5 text-white/35" aria-hidden="true" />}
            </div>
            <p className="mt-4 max-w-xl text-sm text-white/45">
              Run three iterations on the same amount and holding period to compare base, liquidity-adjusted, and stress conclusions.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 p-5">
            {iterations.length > 0 && (
              <IterationComparison
                iterations={iterations}
                activeIterationId={activeIteration?.id ?? 'base'}
                onSelect={(iteration) => setActiveIterationId(iteration.id)}
              />
            )}
            <RiskReport
              report={report}
              onCreateAlert={createAlert}
              creatingAlert={creatingAlert}
              iteration={activeIteration}
            />
          </div>
        )}
      </Card>
    </section>
  );
}

function IterationComparison({
  iterations,
  activeIterationId,
  onSelect,
}: {
  iterations: AnalysisIteration[];
  activeIterationId: AnalysisIteration['id'];
  onSelect: (iteration: AnalysisIteration) => void;
}) {
  const ranked = [...iterations].sort((a, b) => a.score - b.score);
  const best = ranked[0];
  const worstLoss = Math.max(...iterations.map((iteration) => iteration.estimatedLoss));

  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <SectionTitle icon={GitCompareArrows} title="Same-Scenario 3-Iteration Analysis" />
          <p className="mt-2 text-sm text-white/45">
            {best ? `${best.label} is the cleanest pass for this exact amount, price, and holding period.` : 'Run the setup to compare all three analysis passes.'}
          </p>
        </div>
        <div className="rounded-lg border border-red-400/15 bg-red-400/[0.04] px-3 py-2 text-right">
          <div className="text-xs uppercase tracking-wider text-red-200/50">Highest Iteration Loss</div>
          <div className="font-mono text-lg font-semibold text-red-200">Rs. {money(worstLoss)}</div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {iterations.map((iteration) => {
          const active = iteration.id === activeIterationId;
          return (
            <button
              key={iteration.id}
              type="button"
              onClick={() => onSelect(iteration)}
              className={cn(
                'rounded-lg border p-4 text-left transition-[background-color,border-color,transform] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                active ? 'border-amber-400/45 bg-amber-400/10' : 'border-white/10 bg-white/[0.03] hover:border-white/20',
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-semibold text-white">{iteration.label}</span>
                  <span className="block text-xs text-white/35">{iteration.focus}</span>
                </span>
                <Badge tone={decisionTone[iteration.decision]}>{iteration.decision.replace('_', ' ')}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <InfoRow label="Score" value={`${iteration.score}/100`} />
                <InfoRow label="Level" value={iteration.level} />
                <InfoRow label="Exit" value={iteration.exitDays > 30 ? '30+' : `${iteration.exitDays}d`} />
                <InfoRow label="Loss" value={`Rs. ${compact(iteration.estimatedLoss)}`} />
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-white/45">{iteration.summary}</p>
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
  iteration,
}: {
  report: PreTradeRiskReport;
  onCreateAlert: (idea: PreTradeRiskReport['alertPlan'][number]) => void;
  creatingAlert: string | null;
  iteration?: AnalysisIteration;
}) {
  const decision = iteration?.decision ?? report.overall.decision;
  const level = iteration?.level ?? report.overall.level;
  const score = iteration?.score ?? report.overall.score;
  return (
    <div className="grid gap-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-lg border border-white/10 bg-black/20 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-mono text-3xl font-bold text-white">{report.symbol}</h3>
                {iteration && <Badge tone="default">{iteration.focus}</Badge>}
                <Badge tone={decisionTone[decision]}>{decision.replace('_', ' ')}</Badge>
                <Badge tone={levelTone[level]}>{level} Risk</Badge>
                <Badge tone="default">Score {score}/100</Badge>
              </div>
              {report.name && report.name !== report.symbol && <p className="mt-1 truncate text-sm text-white/50">{report.name}</p>}
              <p className="mt-4 max-w-3xl text-sm leading-6 text-white/65">{iteration?.summary ?? report.overall.summary}</p>
              {iteration && (
                <div className="mt-4 grid gap-2">
                  {iteration.checks.map((check) => (
                    <Reason key={check} text={check} />
                  ))}
                </div>
              )}
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
