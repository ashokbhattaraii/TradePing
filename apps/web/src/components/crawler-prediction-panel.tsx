'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock3,
  ExternalLink,
  GitCompareArrows,
  Globe2,
  Layers3,
  Loader2,
  Plus,
  Radar,
  Search,
  Sparkles,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api, type CrawlPredictionReport, type CrawlPredictionStep } from '@/lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Select } from './ui/input';
import { cn } from '@/lib/utils';

type CrawlMode = 'single' | 'compare';
type SourceOption = { id: string; label: string; source: string; url?: string; custom?: boolean };
type CustomSourceInput = { id: string; label: string; url: string };

const SOURCE_OPTIONS: SourceOption[] = [
  { id: 'sharesansar-announcements', label: 'Announcements', source: 'ShareSansar' },
  { id: 'sharesansar-news', label: 'Latest News', source: 'ShareSansar' },
  { id: 'merolagani-news', label: 'Market News', source: 'MeroLagani' },
  { id: 'nepse-notices', label: 'Exchange Notices', source: 'NEPSE' },
  { id: 'nepalipaisa-news', label: 'Stock News', source: 'Nepali Paisa' },
  { id: 'chukul-news', label: 'Market Feed', source: 'Chukul' },
];

const verdictTone = {
  BULLISH: 'success',
  WATCH: 'info',
  NEUTRAL: 'default',
  RISK: 'danger',
} as const;

const sentimentTone = {
  positive: 'success',
  neutral: 'default',
  negative: 'danger',
} as const;

function customSourceId(url: string) {
  try {
    const host = new URL(url.trim()).hostname.replace(/^www\./, '');
    return `custom-${host.replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
  } catch {
    return 'custom-source';
  }
}

function crawlStepTemplates(sources: SourceOption[]): CrawlPredictionStep[] {
  return [
    {
      id: 'normalize-symbols',
      label: 'Normalize symbols',
      status: 'pending',
      detail: 'Cleaning aliases and removing duplicates.',
    },
    {
      id: 'market-snapshot',
      label: 'Read live market snapshot',
      source: 'ShareSansar',
      status: 'pending',
      detail: 'Reading price, change, volume, and turnover.',
    },
    ...sources.map((source) => ({
      id: source.id,
      label: source.custom ? `Crawl ${source.source}` : `Crawl ${source.source} ${source.label}`,
      source: source.source,
      url: source.url,
      status: 'pending' as const,
      detail: source.custom ? 'Scanning custom source URL for stock evidence.' : 'Scanning selected source for related notices.',
    })),
    {
      id: 'score-predictions',
      label: 'Score predictions',
      status: 'pending',
      detail: 'Combining momentum, liquidity, and notice sentiment.',
    },
  ];
}

export function CrawlerPredictionPanel({ symbols }: { symbols: string[] }) {
  const [mode, setMode] = useState<CrawlMode>('single');
  const [singleSymbol, setSingleSymbol] = useState('');
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [pendingCompareSymbol, setPendingCompareSymbol] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(SOURCE_OPTIONS.map((source) => source.id));
  const [customSources, setCustomSources] = useState<CustomSourceInput[]>([]);
  const [customLabel, setCustomLabel] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [steps, setSteps] = useState<CrawlPredictionStep[]>(crawlStepTemplates(SOURCE_OPTIONS));
  const [report, setReport] = useState<CrawlPredictionReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const availableSymbols = useMemo(() => (symbols.length ? symbols : ['NABIL', 'HDL', 'NICA', 'ADBL']).slice().sort(), [symbols]);
  const quickSymbols = useMemo(() => availableSymbols.slice(0, 14), [availableSymbols]);
  const activeSymbols = mode === 'single' ? [singleSymbol].filter(Boolean) : compareSymbols;
  const visibleCount = activeSymbols.length;
  const customSourceOptions = useMemo<SourceOption[]>(
    () => customSources.map((source) => ({ ...source, source: source.label || new URL(source.url).hostname, custom: true })),
    [customSources],
  );
  const allSourceOptions = useMemo(() => [...SOURCE_OPTIONS, ...customSourceOptions], [customSourceOptions]);
  const selectedSources = allSourceOptions.filter((source) => selectedSourceIds.includes(source.id));
  const currentStepTemplates = useMemo(() => crawlStepTemplates(selectedSources), [selectedSources]);

  const clearTicker = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (!singleSymbol && availableSymbols[0]) setSingleSymbol(availableSymbols[0]);
    if (!pendingCompareSymbol && availableSymbols[0]) setPendingCompareSymbol(availableSymbols[0]);
    if (compareSymbols.length === 0 && availableSymbols.length >= 2) {
      setCompareSymbols(availableSymbols.slice(0, 3));
    }
  }, [availableSymbols, compareSymbols.length, pendingCompareSymbol, singleSymbol]);

  useEffect(() => {
    if (!running && !report) setSteps(currentStepTemplates);
  }, [currentStepTemplates, report, running]);

  const runSimulation = () => {
    let index = 0;
    setSteps(
      currentStepTemplates.map((step, i) => ({
        ...step,
        status: i === 0 ? 'running' : 'pending',
        detail: i === 0 ? 'Starting crawl request.' : step.detail,
      })),
    );
    clearTicker();
    intervalRef.current = setInterval(() => {
      index = Math.min(index + 1, currentStepTemplates.length - 1);
      setSteps((prev) =>
        prev.map((step, i) => {
          if (i < index) return { ...step, status: 'done', detail: step.detail };
          if (i === index) return { ...step, status: 'running', detail: 'Working...' };
          return { ...step, status: 'pending' };
        }),
      );
    }, 850);
  };

  const analyze = async () => {
    const symbolsToAnalyze = mode === 'single' ? [singleSymbol].filter(Boolean) : compareSymbols;
    if (symbolsToAnalyze.length === 0) {
      setError('Enter at least one stock symbol.');
      return;
    }
    if (mode === 'compare' && symbolsToAnalyze.length < 2) {
      setError('Enter at least two stock symbols for comparison.');
      return;
    }
    if (selectedSourceIds.length === 0) {
      setError('Select at least one crawling source.');
      return;
    }

    setRunning(true);
    setReport(null);
    setError('');
    runSimulation();
    try {
      const requestCustomSources = customSources.map(({ label, url }) => ({ label, url }));
      const response =
        mode === 'single'
          ? await api.predictStock(symbolsToAnalyze[0], selectedSourceIds, requestCustomSources)
          : await api.compareStocks(symbolsToAnalyze.slice(0, 8), selectedSourceIds, requestCustomSources);
      clearTicker();
      setReport(response.data);
      setSteps(response.data.steps);
    } catch (err) {
      clearTicker();
      setError((err as Error).message || 'Prediction crawl failed.');
      setSteps((prev) =>
        prev.map((step) => (step.status === 'running' ? { ...step, status: 'error', detail: 'Request failed.' } : step)),
      );
    } finally {
      setRunning(false);
    }
  };

  const addSymbol = (symbol: string) => {
    if (mode === 'single') {
      setSingleSymbol(symbol);
      return;
    }
    setCompareSymbols((prev) => (prev.includes(symbol) || prev.length >= 8 ? prev : [...prev, symbol]));
  };

  const changeMode = (nextMode: CrawlMode) => {
    setMode(nextMode);
    setReport(null);
    setSteps(currentStepTemplates);
    setError('');
    if (nextMode === 'single') {
      setSingleSymbol(singleSymbol || compareSymbols[0] || quickSymbols[0] || '');
    } else if (compareSymbols.length < 2) {
      setCompareSymbols(Array.from(new Set([singleSymbol || quickSymbols[0], ...quickSymbols])).filter(Boolean).slice(0, 3));
    }
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId],
    );
  };

  const addPendingCompareSymbol = () => {
    if (!pendingCompareSymbol) return;
    addSymbol(pendingCompareSymbol);
  };

  const removeCompareSymbol = (symbol: string) => {
    setCompareSymbols((prev) => prev.filter((item) => item !== symbol));
  };

  const addCustomSource = () => {
    const url = customUrl.trim();
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        setError('Custom source must start with http:// or https://');
        return;
      }
      const source = {
        id: customSourceId(parsed.toString()),
        label: customLabel.trim() || parsed.hostname.replace(/^www\./, ''),
        url: parsed.toString(),
      };
      setCustomSources((prev) => [...prev, source].slice(0, 6));
      setSelectedSourceIds((prev) => Array.from(new Set([...prev, source.id])));
      setCustomLabel('');
      setCustomUrl('');
      setError('');
    } catch {
      setError('Enter a valid custom source URL.');
    }
  };

  const removeCustomSource = (id: string) => {
    setCustomSources((prev) => prev.filter((source) => source.id !== id));
    setSelectedSourceIds((prev) => prev.filter((sourceId) => sourceId !== id));
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.75fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-5">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Radar className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                Crawl Predictor
              </div>
              <p className="mt-1 text-xs text-white/45">
                {mode === 'single'
                  ? 'Focus all websites on one stock at a time.'
                  : 'Sequentially crawl each stock, then rank the comparison.'}
              </p>
            </div>
            <Badge tone="info">
              {visibleCount}/{mode === 'single' ? 1 : 8}
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => changeMode('single')}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded-md text-xs font-semibold transition-colors',
                mode === 'single' ? 'bg-emerald-400/15 text-white' : 'text-white/50 hover:bg-white/[0.05] hover:text-white',
              )}
            >
              <Radar className="h-3.5 w-3.5" aria-hidden="true" />
              Single stock
            </button>
            <button
              type="button"
              onClick={() => changeMode('compare')}
              className={cn(
                'flex h-9 items-center justify-center gap-2 rounded-md text-xs font-semibold transition-colors',
                mode === 'compare' ? 'bg-blue-400/15 text-white' : 'text-white/50 hover:bg-white/[0.05] hover:text-white',
              )}
            >
              <GitCompareArrows className="h-3.5 w-3.5" aria-hidden="true" />
              Compare
            </button>
          </div>

          <div className="mt-5 grid gap-3">
            {mode === 'single' ? (
              <label className="block">
                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/40">
                  Available stock
                </span>
                <Select value={singleSymbol} onChange={(event) => setSingleSymbol(event.target.value)}>
                  {availableSymbols.map((symbol) => (
                    <option key={symbol} value={symbol} className="bg-zinc-900">
                      {symbol}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <div className="grid gap-3">
                <label className="block">
                  <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/40">
                    Add stock from available list
                  </span>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <Select value={pendingCompareSymbol} onChange={(event) => setPendingCompareSymbol(event.target.value)}>
                      {availableSymbols.map((symbol) => (
                        <option key={symbol} value={symbol} className="bg-zinc-900">
                          {symbol}
                        </option>
                      ))}
                    </Select>
                    <Button type="button" variant="secondary" onClick={addPendingCompareSymbol} disabled={compareSymbols.length >= 8}>
                      Add
                    </Button>
                  </div>
                </label>
                <div className="min-h-20 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-medium uppercase tracking-wide text-white/40">Selected stocks</span>
                    <Badge tone={compareSymbols.length >= 2 ? 'success' : 'warn'}>{compareSymbols.length}/8</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {compareSymbols.length === 0 ? (
                      <span className="text-sm text-white/35">Choose at least two stocks.</span>
                    ) : (
                      compareSymbols.map((symbol) => (
                        <button
                          key={symbol}
                          type="button"
                          onClick={() => removeCompareSymbol(symbol)}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 font-mono text-xs font-semibold text-white/70 transition-colors hover:border-red-400/25 hover:bg-red-400/10 hover:text-red-200"
                          title={`Remove ${symbol}`}
                        >
                          {symbol} x
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {quickSymbols.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => addSymbol(symbol)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-white/60 transition-colors hover:border-emerald-400/25 hover:bg-emerald-400/10 hover:text-white"
              >
                {symbol}
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Layers3 className="h-4 w-4 text-blue-300" aria-hidden="true" />
                Crawl Sources
              </div>
              <Badge tone={selectedSourceIds.length ? 'info' : 'danger'}>
                {selectedSourceIds.length}/{allSourceOptions.length}
              </Badge>
            </div>
            <div className="mb-3 grid gap-2 rounded-lg border border-white/10 bg-black/15 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/40">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                Add Source Website
              </div>
              <input
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder="Source label"
                className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
              />
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={customUrl}
                  onChange={(event) => setCustomUrl(event.target.value)}
                  placeholder="https://example.com/stock-news"
                  className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/10"
                />
                <Button type="button" variant="secondary" size="sm" onClick={addCustomSource} disabled={customSources.length >= 6}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {allSourceOptions.map((source) => {
                const checked = selectedSourceIds.includes(source.id);
                return (
                  <div
                    key={source.id}
	                    className={cn(
	                      'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
	                      checked
	                        ? 'border-emerald-400/25 bg-emerald-400/10'
	                        : 'border-white/10 bg-white/[0.03] hover:border-white/20',
	                    )}
	                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSource(source.id)}
                        className="mt-1 h-4 w-4 accent-emerald-400"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-white">{source.label}</span>
                        <span className="block truncate text-xs text-white/40">{source.source}</span>
                      </span>
                    </label>
                    {source.custom && (
                      <button
                        type="button"
                        onClick={() => removeCustomSource(source.id)}
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-white/35 transition-colors hover:bg-red-400/10 hover:text-red-200"
                        title={`Remove ${source.source}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={analyze} loading={running} className="mt-5 w-full">
            {mode === 'single' ? <Search className="h-4 w-4" aria-hidden="true" /> : <GitCompareArrows className="h-4 w-4" aria-hidden="true" />}
            {mode === 'single' ? 'Crawl One Stock' : 'Crawl and Compare'}
          </Button>

          {error && (
            <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-100">
              {error}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">Crawl Steps</h3>
              <p className="text-xs text-white/40">
                {selectedSources.map((source) => source.source).join(' -> ') || 'No source selected'}
              </p>
            </div>
            {running && <Loader2 className="h-4 w-4 animate-spin text-emerald-300" aria-hidden="true" />}
          </div>
          <CrawlTimeline steps={steps} />
          <div className="grid gap-3">
            {steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-5">
        {report ? (
          <>
            <Card className="p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {report.mode === 'comparison' ? (
                      <GitCompareArrows className="h-4 w-4 text-blue-300" aria-hidden="true" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                    )}
                    {report.mode === 'comparison' ? 'Comparison Summary' : 'Prediction Summary'}
                  </div>
                  <p className="mt-1 text-sm text-white/60">{report.summary}</p>
                </div>
                <Badge tone="success">{new Date(report.generatedAt).toLocaleTimeString()}</Badge>
              </div>
            </Card>

            <PredictionDeepDive report={report} />

            {report.mode === 'comparison' && (
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Comparison Ranking</h3>
                    <p className="text-xs text-white/40">Each symbol was crawled separately, then ranked by signal score.</p>
                  </div>
                  {report.winner && <Badge tone="success">Winner: {report.winner}</Badge>}
                </div>
                <div className="grid gap-2">
                  {report.predictions.map((prediction, index) => (
                    <div
                      key={`rank-${prediction.symbol}`}
                      className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 sm:grid-cols-[44px_minmax(0,1fr)_140px]"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05] font-mono text-sm font-bold text-white">
                        {index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-lg font-bold text-white">{prediction.symbol}</span>
                          <Badge tone={verdictTone[prediction.verdict]}>{prediction.verdict}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-white/45">
                          {prediction.reasons[0]} {prediction.reasons[1]}
                        </p>
                      </div>
                      <div>
                        <div className="mb-1 flex justify-between font-mono text-xs text-white/45">
                          <span className="flex items-center gap-1">
                            <BarChart3 className="h-3 w-3" aria-hidden="true" />
                            Score
                          </span>
                          <span>{prediction.score}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              prediction.score >= 12
                                ? 'bg-emerald-400'
                                : prediction.score <= -18
                                  ? 'bg-red-400'
                                  : 'bg-white/45',
                            )}
                            style={{ width: `${Math.max(6, Math.min(100, prediction.score + 50))}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <div className="grid gap-4">
              {report.predictions.map((prediction) => (
                <Card key={prediction.symbol} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-mono text-2xl font-bold text-white">{prediction.symbol}</h3>
                        <Badge tone={verdictTone[prediction.verdict]}>{prediction.verdict}</Badge>
                        <Badge tone="default">{prediction.confidence}% confidence</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/45">
                        {prediction.price !== undefined && <span>Rs. {prediction.price.toFixed(2)}</span>}
                        {prediction.changePct !== undefined && (
                          <span className={prediction.changePct >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                            {prediction.changePct >= 0 ? '+' : ''}
                            {prediction.changePct.toFixed(2)}%
                          </span>
                        )}
                        {prediction.sector && <span>{prediction.sector}</span>}
                      </div>
                    </div>
                    <div className="min-w-40">
                      <div className="mb-1 flex justify-between text-xs text-white/45">
                        <span>Score</span>
                        <span>{prediction.score}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            prediction.score >= 12
                              ? 'bg-emerald-400'
                              : prediction.score <= -18
                                ? 'bg-red-400'
                                : 'bg-white/45',
                          )}
                          style={{ width: `${Math.max(6, Math.min(100, prediction.score + 50))}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
                        <Target className="h-3.5 w-3.5" aria-hidden="true" />
                        Reasons
                      </h4>
                      <ul className="grid gap-2 text-sm text-white/65">
                        {prediction.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Related Notices</h4>
                      <div className="grid max-h-56 gap-2 overflow-y-auto pr-1 scrollbar-thin">
                        {prediction.notices.length === 0 ? (
                          <p className="text-sm text-white/40">No related notices found.</p>
                        ) : (
                          prediction.notices.map((notice) => (
                            <a
                              key={`${prediction.symbol}-${notice.source}-${notice.title}`}
                              href={notice.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg border border-white/10 bg-black/15 p-3 transition-colors hover:border-white/20 hover:bg-white/[0.05]"
                            >
                              <div className="mb-1 flex items-center justify-between gap-3">
                                <Badge tone={sentimentTone[notice.sentiment]}>{notice.sentiment}</Badge>
                                <span className="flex items-center gap-1 text-[11px] text-white/35">
                                  {notice.source}
                                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </span>
                              </div>
                              <p className="line-clamp-2 text-sm text-white/70">{notice.title}</p>
                            </a>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <Card className="flex min-h-[360px] items-center justify-center p-8 text-center">
            <div>
              <Radar className="mx-auto h-10 w-10 text-emerald-300/70" aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold text-white">Ready to crawl</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/45">
                Enter symbols and start the crawl to watch market data, notices, and scoring unfold.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function CrawlTimeline({ steps }: { steps: CrawlPredictionStep[] }) {
  const complete = steps.filter((step) => step.status === 'done' || step.status === 'warning').length;
  const progress = steps.length ? Math.round((complete / steps.length) * 100) : 0;

  return (
    <div className="mb-4 rounded-lg border border-white/10 bg-black/15 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-white/45">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          Timeline
        </span>
        <span className="font-mono text-xs text-white/45">{progress}%</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {steps.slice(0, 10).map((step) => (
          <div key={`timeline-${step.id}`} className="min-w-0">
            <div
              className={cn(
                'mb-1 h-1.5 rounded-full',
                step.status === 'done' && 'bg-emerald-400',
                step.status === 'running' && 'animate-pulse bg-blue-400',
                step.status === 'warning' && 'bg-amber-400',
                step.status === 'error' && 'bg-red-400',
                step.status === 'pending' && 'bg-white/15',
              )}
            />
            <p className="truncate text-[10px] uppercase tracking-wide text-white/35">{step.source ?? step.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PredictionDeepDive({ report }: { report: CrawlPredictionReport }) {
  const sourceReports = report.sourceReports ?? [];
  const successful = sourceReports.filter((source) => source.status === 'done' || source.status === 'warning').length;
  const failed = sourceReports.filter((source) => source.status === 'error').length;
  const totalNotices = sourceReports.reduce((sum, source) => sum + source.noticesFound, 0);
  const totalBytes = sourceReports.reduce((sum, source) => sum + source.bytesRead, 0);
  const avgConfidence = report.predictions.length
    ? Math.round(report.predictions.reduce((sum, prediction) => sum + prediction.confidence, 0) / report.predictions.length)
    : 0;

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BarChart3 className="h-4 w-4 text-blue-300" aria-hidden="true" />
            Detailed Prediction Page
          </div>
          <p className="mt-1 text-xs text-white/45">
            Evidence coverage, retry diagnostics, source volume, and confidence breakdown.
          </p>
        </div>
        <Badge tone={failed ? 'warn' : 'success'}>
          {successful}/{sourceReports.length} sources usable
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Symbols" value={report.requestedSymbols.length} />
        <MetricTile label="Notices" value={totalNotices} />
        <MetricTile label="Avg Confidence" value={`${avgConfidence}%`} />
        <MetricTile label="Bytes Crawled" value={totalBytes.toLocaleString('en-US')} />
      </div>

      <div className="mt-5 grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-white">Source Diagnostics</h3>
          <span className="text-xs text-white/40">Failures are retried, then skipped without stopping the report.</span>
        </div>
        <div className="grid gap-2">
          {sourceReports.length === 0 ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-white/45">
              No source diagnostics returned yet.
            </div>
          ) : (
            sourceReports.map((source) => (
              <div
                key={`${source.id}-${source.url}`}
                className="grid gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:grid-cols-[minmax(0,1fr)_120px_120px_100px]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={source.status === 'error' ? 'danger' : source.status === 'warning' ? 'warn' : 'success'}>
                      {source.status}
                    </Badge>
                    <span className="font-medium text-white">{source.source}</span>
                  </div>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-xs text-white/40 transition-colors hover:text-white/70"
                  >
                    {source.url}
                  </a>
                  {source.error && <p className="mt-1 text-xs text-red-200/80">{source.error}</p>}
                </div>
                <DiagnosticStat label="Attempts" value={source.attempts} />
                <DiagnosticStat label="Notices" value={source.noticesFound} />
                <DiagnosticStat label="Time" value={`${source.durationMs}ms`} />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        <h3 className="text-sm font-semibold text-white">Prediction Breakdown</h3>
        <div className="grid gap-3">
          {report.predictions.map((prediction) => (
            <div key={`deep-${prediction.symbol}`} className="rounded-lg border border-white/10 bg-black/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-lg font-bold text-white">{prediction.symbol}</span>
                  <Badge tone={verdictTone[prediction.verdict]}>{prediction.verdict}</Badge>
                  <Badge tone="default">Score {prediction.score}</Badge>
                </div>
                <span className="font-mono text-xs text-white/45">{prediction.confidence}% confidence</span>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-white/65">
                {prediction.reasons.map((reason) => (
                  <div key={`${prediction.symbol}-${reason}`} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                    <span>{reason}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function MetricTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold text-white">{value}</div>
    </div>
  );
}

function DiagnosticStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-white/75">{value}</div>
    </div>
  );
}

function StepRow({ step, index }: { step: CrawlPredictionStep; index: number }) {
  const Icon = step.status === 'done' ? CheckCircle2 : step.status === 'error' ? XCircle : step.status === 'warning' ? AlertTriangle : Loader2;

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg border font-mono text-xs',
          step.status === 'done' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
          step.status === 'running' && 'border-blue-400/25 bg-blue-400/10 text-blue-300',
          step.status === 'warning' && 'border-amber-400/25 bg-amber-400/10 text-amber-300',
          step.status === 'error' && 'border-red-400/25 bg-red-400/10 text-red-300',
          step.status === 'pending' && 'border-white/10 bg-white/[0.03] text-white/35',
        )}
      >
        {step.status === 'pending' ? (
          index + 1
        ) : (
          <Icon className={cn('h-4 w-4', step.status === 'running' && 'animate-spin')} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-white">{step.label}</p>
          {step.source && <Badge tone="default">{step.source}</Badge>}
        </div>
        <p className="mt-1 text-xs leading-5 text-white/45">{step.detail}</p>
        {step.durationMs !== undefined && (
          <p className="mt-1 font-mono text-[11px] text-white/30">{step.durationMs}ms</p>
        )}
      </div>
    </div>
  );
}
