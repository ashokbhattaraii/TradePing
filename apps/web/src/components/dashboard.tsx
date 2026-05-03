'use client';

import { useMemo, useState, useEffect } from 'react';
import type { Watchlist } from '@/lib/api';
import {
  Activity,
  AlertTriangle,
  Bell,
  BookMarked,
  BookOpen,
  ChartNoAxesCombined,
  CheckCircle2,
  Command,
  Database,
  ExternalLink,
  Flame,
  Gauge,
  LayoutDashboard,
  LogOut,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  Terminal,
  TrendingDown,
  TrendingUp,
  UserCircle,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { STOCK_ALIASES } from '@tradeping/types';
import type { StockAlert } from '@tradeping/types';
import { StatusCards } from './status-cards';
import { AlertForm } from './alert-form';
import { AlertList } from './alert-list';
import { ManualCheck } from './manual-check';
import { LogsPanel } from './logs-panel';
import { HowItWorks } from './how-it-works';
import { StockPrices } from './stock-prices';
import { SettingsPanel } from './settings-panel';
import { DatabasePanel } from './database-panel';
import { UsersPanel } from './users-panel';
import { RolesPanel } from './roles-panel';
import { CrawlerPredictionPanel } from './crawler-prediction-panel';
import { hasAnyPermission } from '@/lib/permissions';
import { WatchlistPanel } from './watchlist-panel';
import { ToastProvider, useToast } from './ui/toast';
import { ConnectionBanner } from './connection-banner';
import { PriceChart } from './price-chart';
import { useAuth } from './auth-provider';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input, Select } from './ui/input';
import { usePoll } from '@/hooks/use-poll';
import { usePriceStream } from '@/hooks/use-price-stream';
import { api, type PriceSummary } from '@/lib/api';
import { getSector } from '@/lib/sectors';
import { cn } from '@/lib/utils';

type ViewId =
  | 'overview'
  | 'market'
  | 'crawler'
  | 'alerts'
  | 'watchlist'
  | 'activity'
  | 'users'
  | 'roles'
  | 'database'
  | 'guide'
  | 'settings';
type GlobalFilter = 'all' | 'gainers' | 'losers' | 'live' | 'active' | 'triggered' | 'errors';

const views = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, requires: [] },
  { id: 'market', label: 'Live Prices', icon: ChartNoAxesCombined, requires: [] },
  { id: 'crawler', label: 'Crawler', icon: Radar, requires: [] },
  { id: 'alerts', label: 'Alerts', icon: Bell, requires: [] },
  { id: 'watchlist', label: 'Watchlists', icon: BookMarked, requires: [] },
  { id: 'activity', label: 'Activity', icon: Terminal, requires: [] },
  { id: 'users', label: 'Users', icon: Shield, requires: ['users.read'] },
  { id: 'roles', label: 'Roles', icon: ShieldCheck, requires: ['roles.read'] },
  { id: 'database', label: 'Database', icon: Database, requires: ['database.access'] },
  { id: 'guide', label: 'Guide', icon: BookOpen, requires: [] },
  { id: 'settings', label: 'Settings', icon: Settings2, requires: [] },
] satisfies { id: ViewId; label: string; icon: LucideIcon; requires: string[] }[];

const viewIds = new Set<ViewId>(views.map((view) => view.id));

const filterLabels: Record<GlobalFilter, string> = {
  all: 'All Signals',
  gainers: 'Gainers',
  losers: 'Losers',
  live: 'Live Source',
  active: 'Active Alerts',
  triggered: 'Triggered Alerts',
  errors: 'Errors',
};

export function Dashboard() {
  return (
    <ToastProvider>
      <DashboardInner />
    </ToastProvider>
  );
}

function DashboardInner() {
  const toast = useToast();
  const { user, signOut } = useAuth();
  const visibleViews = useMemo(
    () => views.filter((v) => v.requires.length === 0 || hasAnyPermission(user, v.requires)),
    [user],
  );
  const [activeView, setActiveView] = useState<ViewId>('overview');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<GlobalFilter>('all');
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string>('default');
  const [viewInit, setViewInit] = useState(false);

  const settingsFetch = usePoll(() => api.getSettings(), 60_000); // refresh settings every minute
  const uiSettings = settingsFetch.data?.data;
  const pollMs = uiSettings?.uiPollIntervalSeconds ? uiSettings.uiPollIntervalSeconds * 1000 : 5000;
  const logsMax = uiSettings?.uiLogsMaxDisplay ?? 200;

  useEffect(() => {
    if (viewInit) return;

    const params = new URLSearchParams(window.location.search);
    const viewFromUrl = params.get('view') as ViewId | null;
    const configuredView = uiSettings?.uiDefaultView as ViewId | undefined;
    const nextView =
      viewFromUrl && viewIds.has(viewFromUrl)
        ? viewFromUrl
        : configuredView && viewIds.has(configuredView)
          ? configuredView
          : null;

    if (nextView) {
      setActiveView(nextView);
      setViewInit(true);
    } else if (uiSettings) {
      setViewInit(true);
    }
  }, [uiSettings, viewInit]);

  const switchView = (view: ViewId) => {
    setActiveView(view);
    const params = new URLSearchParams(window.location.search);
    params.set('view', view);
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  };

  useEffect(() => {
    api
      .listWatchlists()
      .then((res) => {
        setWatchlists(res.data);
        if (!res.data.some((list) => list.id === activeWatchlistId) && res.data[0]) {
          setActiveWatchlistId(res.data[0].id);
        }
      })
      .catch(() => {
        // The connection banner already owns offline feedback.
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const health = usePoll(() => api.health(), pollMs);
  const alerts = usePoll(() => api.listAlerts(), pollMs);
  const logs = usePoll(() => api.logs(), pollMs);
  const prices = usePriceStream(pollMs);

  const apiOnline = !health.error && health.data?.status === 'ok';
  const alertList = useMemo(() => alerts.data?.data ?? [], [alerts.data]);
  const logList = useMemo(() => (logs.data?.data ?? []).slice(0, logsMax), [logs.data, logsMax]);
  const priceList = useMemo(() => prices.data ?? [], [prices.data]);
  const lastCheckAt = logList.find((l) => l.message.includes('check completed'))?.timestamp ?? null;

  const refreshAll = () => {
    void alerts.refetch();
    void logs.refetch();
    api
      .refreshPrices()
      .then(() => toast.push('success', 'Prices refreshed'))
      .catch((err: Error) => toast.push('error', err.message || 'Failed to refresh prices'))
      .finally(() => void prices.refetch());
  };

  const retryConnection = () => {
    void health.refetch();
    void prices.refetch();
    void alerts.refetch();
    void logs.refetch();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (...values: (string | number | null | undefined)[]) =>
      !q || values.some((value) => String(value ?? '').toLowerCase().includes(q));
    const aliasesFor = (symbol: string) =>
      Object.entries(STOCK_ALIASES)
        .filter(([, target]) => target === symbol)
        .map(([alias]) => alias);

    const priceMatches = (price: PriceSummary) => {
      const passesFilter =
        filter === 'all' ||
        (filter === 'gainers' && price.change > 0) ||
        (filter === 'losers' && price.change < 0) ||
        (filter === 'live' && price.source === 'LIVE') ||
        filter === 'active' ||
        filter === 'triggered' ||
        filter === 'errors';
      return (
        passesFilter &&
        matches(price.symbol, ...aliasesFor(price.symbol), price.sector ?? getSector(price.symbol), price.source, price.price, price.changePct)
      );
    };

    const alertMatches = (alert: StockAlert) => {
      const passesFilter =
        filter === 'all' ||
        (filter === 'active' && alert.status === 'ACTIVE') ||
        (filter === 'triggered' && alert.status === 'TRIGGERED') ||
        filter === 'gainers' ||
        filter === 'losers' ||
        filter === 'live' ||
        filter === 'errors';
      return passesFilter && matches(alert.symbol, ...aliasesFor(alert.symbol), alert.status, alert.condition, alert.targetPrice);
    };

    const logMatches = (log: (typeof logList)[number]) => {
      const passesFilter = filter !== 'errors' || log.level === 'ERROR';
      return passesFilter && matches(log.level, log.message, log.timestamp);
    };

    return {
      prices: priceList.filter(priceMatches),
      alerts: alertList.filter(alertMatches),
      logs: logList.filter(logMatches),
    };
  }, [alertList, filter, logList, priceList, query]);

  const activeAlerts = alertList.filter((a) => a.status === 'ACTIVE').length;
  const triggeredAlerts = alertList.filter((a) => a.status === 'TRIGGERED').length;
  const activeTitle = views.find((view) => view.id === activeView)?.label ?? 'Overview';
  const recentAlerts = filtered.alerts.slice(0, 5);
  const recentLogs = filtered.logs.slice(0, activeView === 'overview' ? 8 : filtered.logs.length);
  const liveSymbols = useMemo(
    () => Array.from(new Set(priceList.map((price) => price.symbol))).sort((a, b) => a.localeCompare(b)),
    [priceList],
  );

  const watchedSymbols = useMemo(() => {
    const active = watchlists.find((l) => l.id === activeWatchlistId);
    return new Set(active?.symbols ?? []);
  }, [watchlists, activeWatchlistId]);

  const handleStar = async (symbol: string) => {
    try {
      const res = await api.addToWatchlist(activeWatchlistId, symbol);
      setWatchlists((prev) => {
        const exists = prev.some((l) => l.id === res.data.id);
        return exists ? prev.map((l) => (l.id === res.data.id ? res.data : l)) : [...prev, res.data];
      });
      setActiveWatchlistId(res.data.id);
      toast.push('success', `${symbol} added to watchlist`);
    } catch (err) {
      toast.push('error', (err as Error).message || `Failed to add ${symbol}`);
    }
  };

  const handleUnstar = async (symbol: string) => {
    try {
      const res = await api.removeFromWatchlist(activeWatchlistId, symbol);
      setWatchlists((prev) => prev.map((l) => (l.id === res.data.id ? res.data : l)));
      toast.push('info', `${symbol} removed from watchlist`);
    } catch (err) {
      toast.push('error', (err as Error).message || `Failed to remove ${symbol}`);
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden lg:h-screen lg:overflow-hidden">
      <a
        href="#dashboard-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to Content
      </a>

      <ConnectionBanner online={apiOnline} onRetry={retryConnection} />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/85 px-4 py-3 backdrop-blur-xl sm:px-6 lg:relative">
        <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10">
                  <Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold text-white">TradePing</h1>
                  <p className="truncate text-xs text-white/45">NEPSE signal desk</p>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={apiOnline ? 'success' : 'danger'} dot>
                {apiOnline ? 'Online' : 'Offline'}
              </Badge>
              <div className="hidden max-w-44 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1.5 sm:flex">
                {user.picture ? (
                  <span
                    className="h-5 w-5 shrink-0 rounded-full bg-cover bg-center"
                    style={{ backgroundImage: `url(${user.picture})` }}
                    aria-hidden="true"
                  />
                ) : (
                  <UserCircle className="h-5 w-5 text-white/45" aria-hidden="true" />
                )}
                <span className="truncate text-xs font-medium text-white/65">{user.email}</span>
                {user.role === 'ADMIN' && (
                  <span
                    className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200"
                    title="Administrator"
                  >
                    Admin
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                onClick={signOut}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-white/50 transition-colors hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_180px_auto] lg:w-[720px]">
            {activeView === 'watchlist' && watchlists.length > 0 ? (
              <label className="relative block min-w-0">
                <span className="sr-only">Switch watchlist</span>
                <BookMarked
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
                  aria-hidden="true"
                />
                <Select
                  name="watchlistSelect"
                  aria-label="Switch watchlist"
                  value={activeWatchlistId}
                  onChange={(e) => setActiveWatchlistId(e.target.value)}
                  className="pl-9"
                >
                  {watchlists.map((wl) => (
                    <option key={wl.id} value={wl.id} className="bg-zinc-900">
                      {wl.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <label className="relative block min-w-0">
                <span className="sr-only">Search market data, alerts, and logs</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35"
                  aria-hidden="true"
                />
                <Input
                  name="globalSearch"
                  type="search"
                  autoComplete="off"
                  placeholder="Search symbols, alerts, logs…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                />
              </label>
            )}

            <label className="relative block">
              <span className="sr-only">Global filter</span>
              <Select
                name="globalFilter"
                aria-label="Global filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value as GlobalFilter)}
              >
                {Object.entries(filterLabels).map(([value, label]) => (
                  <option key={value} value={value} className="bg-zinc-900">
                    {label}
                  </option>
                ))}
              </Select>
            </label>

            <Button variant="secondary" onClick={refreshAll} className="justify-center">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <div className="grid w-full gap-0 lg:h-[calc(100vh-65px)] lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 px-4 py-3 sm:px-6 lg:border-b-0 lg:border-r lg:px-4 lg:py-6 xl:px-5">
          <nav aria-label="Dashboard sections" className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {visibleViews.map((view) => {
              const Icon = view.icon;
              const active = activeView === view.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => switchView(view.id)}
                  className={cn(
                    'flex h-11 min-w-32 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 lg:w-full',
                    active
                      ? 'border border-emerald-400/25 bg-emerald-400/10 text-white shadow-[inset_3px_0_0_rgba(52,211,153,0.85)]'
                      : 'border border-transparent text-white/55 hover:bg-white/[0.05] hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{view.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-5 hidden space-y-3 lg:block">
            <MiniStat icon={ChartNoAxesCombined} label="Prices" value={filtered.prices.length} />
            <MiniStat icon={Bell} label="Alerts" value={filtered.alerts.length} />
            <MiniStat icon={Terminal} label="Logs" value={filtered.logs.length} />
          </div>
        </aside>

        <main
          id="dashboard-content"
          className="min-w-0 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:px-6 lg:py-7 xl:px-8"
        >
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-white/40">
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                {filterLabels[filter]}
              </div>
              <h2 className="text-2xl font-semibold text-white text-balance">{activeTitle}</h2>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/45">
              <Command className="h-3.5 w-3.5" aria-hidden="true" />
              {query ? `Filtering by ${query}` : 'Global search ready'}
            </div>
          </div>

          {activeView === 'overview' && (
            <div className="grid gap-5">
              <StatusCards
                apiOnline={apiOnline}
                activeAlerts={activeAlerts}
                lastCheckAt={lastCheckAt}
                totalLogs={logList.length}
              />
              <OverviewActions
                apiOnline={apiOnline}
                activeAlerts={activeAlerts}
                triggeredAlerts={triggeredAlerts}
                prices={priceList}
                onOpenPrices={() => switchView('market')}
                onOpenActivity={() => switchView('activity')}
              />
              <MarketCommandCenter
                prices={filtered.prices}
                alerts={alertList}
                onOpenPrices={() => switchView('market')}
              />
              <div className="grid gap-5 xl:grid-cols-[minmax(380px,0.68fr)_minmax(0,1fr)]">
                <div className="grid content-start gap-5">
                  <AlertForm onCreated={refreshAll} symbols={liveSymbols} prices={priceList} defaultCondition={uiSettings?.alertDefaultCondition} defaultPriority={uiSettings?.alertDefaultPriority} />
                </div>
                <div className="grid content-start gap-5">
                  <AlertList
                    alerts={recentAlerts}
                    loading={alerts.loading}
                    onChanged={refreshAll}
                    title="Recent Alerts"
                    emptyCopy="No alerts match the current search or filter."
                    prices={priceList}
                  />
                  <LogsPanel logs={recentLogs} loading={logs.loading} />
                </div>
              </div>
            </div>
          )}

          {activeView === 'market' && (
            <StockPrices
              prices={filtered.prices}
              loading={prices.data === null}
              emptyCopy="No prices match the current search or filter."
              watchedSymbols={watchedSymbols}
              onStar={handleStar}
              onUnstar={handleUnstar}
              signalSettings={uiSettings}
            />
          )}

          {activeView === 'crawler' && <CrawlerPredictionPanel symbols={liveSymbols} />}

          {activeView === 'alerts' && (
            <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.7fr)_minmax(0,1fr)]">
              <div className="grid content-start gap-5">
                <AlertForm onCreated={refreshAll} symbols={liveSymbols} prices={priceList} defaultCondition={uiSettings?.alertDefaultCondition} defaultPriority={uiSettings?.alertDefaultPriority} />
              </div>
              <AlertList
                alerts={filtered.alerts}
                loading={alerts.loading}
                onChanged={refreshAll}
                title="Alert Queue"
                emptyCopy="No alerts match the current search or filter."
                prices={priceList}
              />
            </div>
          )}

          {activeView === 'activity' && (
            <div className="grid gap-5">
              <ManualCheck onCheck={refreshAll} />
              {/* Controls row — compact strip above the log table */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mt-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-400/10">
                    <Zap className="h-4 w-4 text-sky-300" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">Crawler Activity</h3>
                    <p className="text-xs text-white/40">Real-time event stream from the NEPSE price crawler.</p>
                  </div>
                </div>
                <ManualCheck onCheck={refreshAll} compact />
              </div>
              {/* Full-width log table */}
              <LogsPanel logs={filtered.logs} loading={logs.loading} />
            </div>
          )}

          {activeView === 'watchlist' && (
            <WatchlistPanel
              prices={priceList}
              alerts={alertList}
              externalActiveId={activeWatchlistId}
              onActiveIdChange={setActiveWatchlistId}
              onListsChange={setWatchlists}
            />
          )}

          {activeView === 'users' && <UsersPanel />}

          {activeView === 'roles' && <RolesPanel />}

          {activeView === 'database' && <DatabasePanel />}

          {activeView === 'guide' && <HowItWorks />}

          {activeView === 'settings' && <SettingsPanel />}
        </main>
      </div>
    </div>
  );
}

function chartUrl(symbol: string) {
  return `https://www.nepsealpha.com/trading/chart?symbol=${encodeURIComponent(symbol)}`;
}

function OverviewActions({
  apiOnline,
  activeAlerts,
  triggeredAlerts,
  prices,
  onOpenPrices,
  onOpenActivity,
}: {
  apiOnline: boolean;
  activeAlerts: number;
  triggeredAlerts: number;
  prices: PriceSummary[];
  onOpenPrices: () => void;
  onOpenActivity: () => void;
}) {
  const gainers = prices.filter((price) => price.change > 0).length;
  const losers = prices.filter((price) => price.change < 0).length;
  const livePrices = prices.filter((price) => price.source === 'LIVE').length;
  const topGainer = [...prices].sort((a, b) => b.changePct - a.changePct)[0];
  const topLoser = [...prices].sort((a, b) => a.changePct - b.changePct)[0];

  return (
    <section className="grid gap-4 xl:grid-cols-4">
      <ActionCard
        icon={apiOnline ? CheckCircle2 : AlertTriangle}
        label="System"
        value={apiOnline ? 'Crawler Ready' : 'Needs Attention'}
        body={apiOnline ? 'Backend is responding and checks can run.' : 'API is offline. Check the backend server.'}
        tone={apiOnline ? 'success' : 'danger'}
        action="Open Activity"
        onAction={onOpenActivity}
      />
      <ActionCard
        icon={Bell}
        label="Alerts"
        value={`${activeAlerts} Active`}
        body={`${triggeredAlerts} triggered alert${triggeredAlerts === 1 ? '' : 's'} in the queue.`}
        tone="info"
      />
      <ActionCard
        icon={TrendingUp}
        label="Market Pulse"
        value={`${gainers} Up / ${losers} Down`}
        body={topGainer ? `Top move: ${topGainer.symbol} +${topGainer.changePct.toFixed(2)}%.` : 'Waiting for market data.'}
        tone="success"
        action="Open Live Prices"
        onAction={onOpenPrices}
      />
      <ActionCard
        icon={TrendingDown}
        label="Risk Watch"
        value={topLoser ? topLoser.symbol : 'No Drops'}
        body={
          topLoser && topLoser.change < 0
            ? `${topLoser.changePct.toFixed(2)}% today from ${livePrices} live quotes.`
            : `${livePrices} live quotes available right now.`
        }
        tone="warn"
        action="Review Prices"
        onAction={onOpenPrices}
      />
    </section>
  );
}

function MarketCommandCenter({
  prices,
  alerts,
  onOpenPrices,
}: {
  prices: PriceSummary[];
  alerts: StockAlert[];
  onOpenPrices: () => void;
}) {
  const stats = useMemo(() => {
    const gainers = prices.filter((p) => p.change > 0);
    const losers = prices.filter((p) => p.change < 0);
    const totalTurnover = prices.reduce((sum, p) => sum + (p.turnover ?? 0), 0);
    const totalVolume = prices.reduce((sum, p) => sum + (p.volume ?? 0), 0);
    const leaders = [...prices].sort((a, b) => b.changePct - a.changePct).slice(0, 5);
    const pressure = [...prices].sort((a, b) => a.changePct - b.changePct).slice(0, 5);
    const turnover = [...prices].sort((a, b) => (b.turnover ?? 0) - (a.turnover ?? 0)).slice(0, 5);
    const watched = prices.filter((price) => alerts.some((alert) => alert.symbol === price.symbol));
    const pcil = prices.find((price) => price.symbol === 'PCIL');
    return { gainers, losers, totalTurnover, totalVolume, leaders, pressure, turnover, watched, pcil };
  }, [alerts, prices]);

  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
      <Card className="p-0">
        <div className="border-b border-white/5 px-5 py-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-semibold text-white">Market Command Center</h3>
              <p className="text-sm text-white/45">Breadth, liquidity, movers, and your watched symbols in one place.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={onOpenPrices}>
              Open Full Market
            </Button>
          </div>
        </div>
        <div className="grid gap-4 p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <InsightMetric icon={Gauge} label="Breadth" value={`${stats.gainers.length}/${stats.losers.length}`} sub="up/down" />
            <InsightMetric icon={Flame} label="Turnover" value={`Rs. ${compact(stats.totalTurnover)}`} sub="market flow" />
            <InsightMetric icon={ChartNoAxesCombined} label="Volume" value={compact(stats.totalVolume)} sub="shares traded" />
            <InsightMetric icon={Target} label="Watched" value={stats.watched.length.toString()} sub="symbols with alerts" />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <MoverList title="Top Gainers" items={stats.leaders} tone="up" />
            <MoverList title="Pressure" items={stats.pressure} tone="down" />
            <MoverList title="Turnover Leaders" items={stats.turnover} tone="neutral" />
          </div>
        </div>
      </Card>

      <section className="grid gap-5">
        <ChartSpotlight price={stats.pcil ?? stats.turnover[0]} />
        <WatchedSymbols prices={stats.watched} />
      </section>
    </section>
  );
}

function InsightMetric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.03] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs uppercase tracking-wider text-white/40">{label}</span>
        <Icon className="h-4 w-4 shrink-0 text-white/35" aria-hidden="true" />
      </div>
      <div className="truncate text-xl font-semibold tabular-nums text-white">{value}</div>
      <div className="mt-1 truncate text-xs text-white/40">{sub}</div>
    </div>
  );
}

function MoverList({
  title,
  items,
  tone,
}: {
  title: string;
  items: PriceSummary[];
  tone: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-black/20 p-4">
      <h4 className="mb-3 text-sm font-semibold text-white">{title}</h4>
      <ul className="space-y-2">
        {items.length === 0 ? (
          <li className="text-sm text-white/35">No data yet.</li>
        ) : (
          items.map((price) => (
            <li key={`${title}-${price.symbol}`} className="flex items-center justify-between gap-3">
              <a
                href={chartUrl(price.symbol)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-mono text-sm font-semibold text-white hover:text-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
              >
                {price.symbol}
              </a>
              <span
                className={cn(
                  'shrink-0 font-mono text-xs tabular-nums',
                  tone === 'up'
                    ? 'text-emerald-300'
                    : tone === 'down'
                      ? 'text-red-300'
                      : 'text-white/60',
                )}
              >
                {tone === 'neutral' ? `Rs. ${compact(price.turnover ?? 0)}` : `${price.changePct.toFixed(2)}%`}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function ChartSpotlight({ price }: { price: PriceSummary | undefined }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Chart Spotlight</h3>
          <p className="text-sm text-white/45">Open the live NepseAlpha chart for the selected symbol.</p>
        </div>
        <ExternalLink className="h-4 w-4 text-white/35" aria-hidden="true" />
      </div>
      {price ? (
        <div className="grid gap-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="font-mono text-3xl font-semibold text-white">{price.symbol}</div>
              <div className="mt-1 text-sm text-white/45">Rs. {price.price.toLocaleString('en-NP')}</div>
            </div>
            <div className={cn('font-mono text-sm tabular-nums', price.change >= 0 ? 'text-emerald-300' : 'text-red-300')}>
              {price.change >= 0 ? '+' : ''}
              {price.changePct.toFixed(2)}%
            </div>
          </div>
          <PriceChart symbol={price.symbol} currentPrice={price.price} />
          <a
            href={chartUrl(price.symbol)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-black transition-[background-color,transform] hover:bg-white/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            Open NepseAlpha Chart
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/40">
          Waiting for market data…
        </div>
      )}
    </Card>
  );
}

function WatchedSymbols({ prices }: { prices: PriceSummary[] }) {
  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold text-white">Watched Symbols</h3>
      <p className="mt-1 text-sm text-white/45">Symbols connected to your active or triggered alerts.</p>
      <div className="mt-4 grid gap-2">
        {prices.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/40">
            Create alerts to build a watchlist.
          </div>
        ) : (
          prices.slice(0, 6).map((price) => (
            <a
              key={price.symbol}
              href={chartUrl(price.symbol)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 transition-[background-color,border-color,color] hover:border-sky-400/30 hover:bg-sky-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
            >
              <span className="font-mono text-sm font-semibold text-white">{price.symbol}</span>
              <span className={cn('font-mono text-xs tabular-nums', price.change >= 0 ? 'text-emerald-300' : 'text-red-300')}>
                {price.change >= 0 ? '+' : ''}
                {price.changePct.toFixed(2)}%
              </span>
            </a>
          ))
        )}
      </div>
    </Card>
  );
}

function ActionCard({
  icon: Icon,
  label,
  value,
  body,
  tone,
  action,
  onAction,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  body: string;
  tone: 'success' | 'info' | 'warn' | 'danger';
  action?: string;
  onAction?: () => void;
}) {
  const tones: Record<typeof tone, string> = {
    success: 'bg-emerald-400/10 text-emerald-300',
    info: 'bg-sky-400/10 text-sky-300',
    warn: 'bg-amber-400/10 text-amber-300',
    danger: 'bg-red-400/10 text-red-300',
  };

  return (
    <Card className="grid min-h-44 content-between gap-4 p-5">
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg', tones[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="truncate text-xs font-medium uppercase tracking-wider text-white/40">
            {label}
          </span>
        </div>
        <div className="truncate text-xl font-semibold text-white">{value}</div>
        <p className="mt-2 text-sm leading-5 text-white/50">{body}</p>
      </div>
      {action && onAction && (
        <Button type="button" variant="secondary" size="sm" onClick={onAction} className="w-full">
          {action}
        </Button>
      )}
    </Card>
  );
}

function compact(value: number) {
  return new Intl.NumberFormat('en-NP', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/35" aria-hidden="true" />
        <span className="truncate text-xs text-white/45">{label}</span>
      </div>
      <span className="font-mono text-xs font-semibold tabular-nums text-white">{value}</span>
    </div>
  );
}
