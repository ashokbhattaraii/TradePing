'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BookMarked,
  CheckCircle2,
  Clock,
  Database,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Hash,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  Settings2,
  Shield,
  Smartphone,
  Timer,
  ToggleLeft,
  ToggleRight,
  Wifi,
  Zap,
} from 'lucide-react';
import { api, type SystemSettings } from '@/lib/api';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { NotificationDefaults } from './notification-defaults';

type Tab = 'crawler' | 'alerts' | 'watchlist' | 'intelligence' | 'ui' | 'network' | 'notifications' | 'system';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// ── Preset configurations ────────────────────────────────────────────────────
const PRESETS: Record<string, Partial<Omit<SystemSettings, 'port' | 'frontendUrl'>>> = {
  conservative: {
    crawlerIntervalSeconds: 30,
    pageCacheTtlSeconds: 60,
    crawlerTimeoutSeconds: 20,
    crawlerRetryCount: 3,
    marketHoursOnly: true,
    crawlerMaxSymbolsPerTick: 0,
  },
  standard: {
    crawlerIntervalSeconds: 5,
    pageCacheTtlSeconds: 30,
    crawlerTimeoutSeconds: 15,
    crawlerRetryCount: 2,
    marketHoursOnly: false,
    crawlerMaxSymbolsPerTick: 0,
  },
  aggressive: {
    crawlerIntervalSeconds: 2,
    pageCacheTtlSeconds: 10,
    crawlerTimeoutSeconds: 8,
    crawlerRetryCount: 1,
    marketHoursOnly: false,
    crawlerMaxSymbolsPerTick: 0,
  },
};

interface NumFieldConfig {
  kind: 'number';
  key: keyof Omit<SystemSettings, 'port' | 'frontendUrl' | 'marketHoursOnly' | 'watchlistAutoAddAlertSymbol' | 'watchlistAutoRemoveOnAllTriggered'>;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  hot: boolean;
  warn?: string;
}

interface BoolFieldConfig {
  kind: 'boolean';
  key:
    | 'marketHoursOnly'
    | 'watchlistAutoAddAlertSymbol'
    | 'watchlistAutoRemoveOnAllTriggered'
    | 'crawlerMockOnFetchFail'
    | 'crawlerPrefetchOnStart'
    | 'alertNotifyOnCreate'
    | 'alertNotifyOnExpiry'
    | 'signalEngineEnabled'
    | 'slackEnabled'
    | 'whatsappEnabled'
    | 'crawlerUseProxy'
    | 'enableAdvancedLogging'
    | 'crawlerLogFailedRequests';
  label: string;
  description: string;
  hot: boolean;
}

type BoolSettingKey = BoolFieldConfig['key'];

interface TextFieldConfig {
  kind: 'text';
  key:
    | 'frontendUrl'
    | 'slackWebhookUrl'
    | 'whatsappPhone'
    | 'whatsappFromNumber'
    | 'whatsappAccountSid'
    | 'whatsappAuthToken'
    | 'crawlerUserAgent'
    | 'alertDefaultCondition'
    | 'alertDefaultPriority'
    | 'uiDefaultView'
    | 'slackMessageTemplate'
    | 'whatsappMessageTemplate'
    | 'proxyUrl'
    | 'uiThemePreference';
  label: string;
  description: string;
  hot: boolean;
  warn?: string;
  secret?: boolean;
  placeholder?: string;
}

type FieldConfig = NumFieldConfig | BoolFieldConfig | TextFieldConfig;

const CRAWLER_FIELDS: FieldConfig[] = [
  {
    kind: 'number',
    key: 'crawlerIntervalSeconds',
    label: 'Check Interval',
    description: 'How often active alerts are evaluated against the latest price.',
    unit: 'sec',
    min: 1,
    max: 300,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'pageCacheTtlSeconds',
    label: 'Page Cache TTL',
    description: 'Minimum gap between real HTTP requests to ShareSansar. Prevents rate-limiting.',
    unit: 'sec',
    min: 5,
    max: 600,
    step: 5,
    hot: true,
  },
  {
    kind: 'number',
    key: 'crawlerTimeoutSeconds',
    label: 'Request Timeout',
    description: 'How long to wait for ShareSansar before giving up on a single attempt.',
    unit: 'sec',
    min: 3,
    max: 60,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'crawlerRetryCount',
    label: 'Retry Count',
    description: 'Additional fetch attempts after a timeout or HTTP error before using mock data.',
    unit: 'retries',
    min: 0,
    max: 5,
    step: 1,
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'marketHoursOnly',
    label: 'Market Hours Only',
    description: 'Restrict alert evaluation to NEPSE trading hours (Sun–Thu 11:00–15:00 NPT). Saves resources off-hours.',
    hot: true,
  },
  {
    kind: 'number',
    key: 'crawlerMaxSymbolsPerTick',
    label: 'Max Symbols per Tick',
    description: 'Cap how many alerts are evaluated per interval tick. 0 = no limit (evaluates all active alerts).',
    unit: 'symbols',
    min: 0,
    max: 500,
    step: 10,
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'crawlerPrefetchOnStart',
    label: 'Prefetch on Start',
    description: 'Fetch all stocks immediately on server boot (recommended).',
    hot: false,
  },
  {
    kind: 'boolean',
    key: 'crawlerMockOnFetchFail',
    label: 'Fallback to Mock',
    description: 'Use randomly simulated prices if ShareSansar goes down. Useful for testing alerts when market is closed.',
    hot: true,
  },
  {
    kind: 'text',
    key: 'crawlerUserAgent',
    label: 'HTTP User-Agent',
    description: 'The browser string sent to ShareSansar.',
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'crawlerUseProxy',
    label: 'Use Proxy',
    description: 'Route crawler traffic through a proxy server.',
    hot: true,
  },
  {
    kind: 'text',
    key: 'proxyUrl',
    label: 'Proxy URL',
    description: 'URL of the proxy server (e.g., http://proxy:8080).',
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'enableAdvancedLogging',
    label: 'Enable Advanced Logging',
    description: 'Log deeper technical details in the system console.',
    hot: false,
  },
  {
    kind: 'boolean',
    key: 'crawlerLogFailedRequests',
    label: 'Log Failed Requests',
    description: 'Keep detailed records of network failures during crawling.',
    hot: true,
  },
  {
    kind: 'text',
    key: 'uiThemePreference',
    label: 'UI Theme Preference',
    description: 'Default user interface theme (light/dark/system).',
    hot: false,
  },
];

const ALERT_FIELDS: FieldConfig[] = [
  {
    kind: 'number',
    key: 'alertMaxPerSymbol',
    label: 'Max Alerts per Symbol',
    description: 'Cap on simultaneous ACTIVE alerts for one symbol. Prevents spam. 0 = unlimited.',
    unit: 'alerts',
    min: 0,
    max: 20,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'alertExpiryHours',
    label: 'Alert Expiry',
    description: 'ACTIVE alerts older than this are silently removed. 0 = keep forever.',
    unit: 'hrs',
    min: 0,
    max: 720,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'alertAutoDeleteTriggeredMinutes',
    label: 'Triggered Retention',
    description: 'Remove triggered alerts this many minutes after firing. 0 = keep indefinitely.',
    unit: 'min',
    min: 0,
    max: 1440,
    step: 5,
    hot: true,
  },
  {
    kind: 'number',
    key: 'alertRepeatAfterMinutes',
    label: 'Repeat Interval',
    description: 'Re-activate a triggered alert after N minutes so it can fire again. 0 = one-shot (never repeats).',
    unit: 'min',
    min: 0,
    max: 1440,
    step: 5,
    hot: true,
  },
  {
    kind: 'text',
    key: 'alertDefaultCondition',
    label: 'Default Condition',
    description: 'Pre-filled condition in UI forms (ABOVE, BELOW, EQUAL).',
    hot: false,
  },
  {
    kind: 'text',
    key: 'alertDefaultPriority',
    label: 'Default Priority',
    description: 'Pre-filled priority in UI forms (HIGH, MEDIUM, LOW).',
    hot: false,
  },
  {
    kind: 'boolean',
    key: 'alertNotifyOnCreate',
    label: 'Notify on Create',
    description: 'Send a notification whenever a new alert is created.',
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'alertNotifyOnExpiry',
    label: 'Notify on Expiry',
    description: 'Send a notification when an active alert expires.',
    hot: true,
  },
  {
    kind: 'number',
    key: 'notificationCooldownMinutes',
    label: 'Notification Cooldown',
    description: 'Minimum minutes between consecutive identical notifications. 0 = no cooldown.',
    unit: 'min',
    min: 0,
    max: 1440,
    step: 1,
    hot: true,
  },
];

const NETWORK_FIELDS: FieldConfig[] = [
  {
    kind: 'text',
    key: 'frontendUrl',
    label: 'Frontend CORS Origin',
    description: 'The allowed cross-origin for API requests. Requires restart.',
    hot: false,
    warn: 'Requires server restart to take effect.',
  },
];

const WATCHLIST_FIELDS: FieldConfig[] = [
  {
    kind: 'number',
    key: 'watchlistMaxSymbolsPerList',
    label: 'Max Symbols per List',
    description: 'Cap on how many symbols a single watchlist can hold. 0 = no limit (up to 100).',
    unit: 'symbols',
    min: 0,
    max: 500,
    step: 10,
    hot: true,
  },
  {
    kind: 'number',
    key: 'watchlistSymbolExpiryDays',
    label: 'Symbol Expiry',
    description: 'Auto-remove symbols that have been in the watchlist longer than N days. 0 = keep forever.',
    unit: 'days',
    min: 0,
    max: 365,
    step: 1,
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'watchlistAutoAddAlertSymbol',
    label: 'Auto-add on Alert',
    description: 'Automatically add a symbol to the default watchlist whenever a new alert is created for it.',
    hot: true,
  },
  {
    kind: 'boolean',
    key: 'watchlistAutoRemoveOnAllTriggered',
    label: 'Auto-remove When All Triggered',
    description: 'Remove a symbol from all watchlists once every alert linked to it has been triggered.',
    hot: true,
  },
];

const INTELLIGENCE_FIELDS: FieldConfig[] = [
  {
    kind: 'boolean',
    key: 'signalEngineEnabled',
    label: 'TradePing Signal Engine',
    description: 'Show proprietary edge scores, action hints, and setup labels inside stock details.',
    hot: true,
  },
  {
    kind: 'number',
    key: 'signalMomentumThresholdPct',
    label: 'Momentum Threshold',
    description: 'Minimum move from previous close before a symbol is treated as a momentum setup.',
    unit: '%',
    min: 0,
    max: 20,
    step: 0.25,
    hot: true,
  },
  {
    kind: 'number',
    key: 'signalLiquidityFloor',
    label: 'Liquidity Floor',
    description: 'Minimum turnover required before TradePing calls a signal liquid enough to act on.',
    unit: 'Rs.',
    min: 0,
    max: 100000000,
    step: 50000,
    hot: true,
  },
  {
    kind: 'number',
    key: 'signalBreakoutRangePct',
    label: 'Breakout Zone',
    description: 'Daily range position that marks a high-side breakout watch.',
    unit: '%',
    min: 50,
    max: 100,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'signalDipRangePct',
    label: 'Dip Zone',
    description: 'Daily range position that marks a low-side dip watch.',
    unit: '%',
    min: 0,
    max: 50,
    step: 1,
    hot: true,
  },
  {
    kind: 'number',
    key: 'signalAutoWatchScore',
    label: 'Auto-watch Score',
    description: 'Reserve threshold for automatic watch suggestions. 0 keeps it manual.',
    unit: 'score',
    min: 0,
    max: 100,
    step: 5,
    hot: true,
  },
];

const UI_FIELDS: FieldConfig[] = [
  {
    kind: 'number',
    key: 'uiPollIntervalSeconds',
    label: 'UI Polling Interval',
    description: 'How often the dashboard refreshes its data from the server.',
    unit: 'sec',
    min: 1,
    max: 600,
    step: 5,
    hot: true,
  },
  {
    kind: 'number',
    key: 'uiLogsMaxDisplay',
    label: 'Max Dashboard Logs',
    description: 'Maximum number of recent logs kept in the UI view.',
    unit: 'logs',
    min: 10,
    max: 1000,
    step: 10,
    hot: false,
  },
  {
    kind: 'text',
    key: 'uiDefaultView',
    label: 'Default View',
    description: 'The dashboard section users see first unless the URL includes a view.',
    placeholder: 'overview',
    hot: true,
  }
];

const TABS: { id: Tab; label: string; icon: React.ElementType; fields?: FieldConfig[] }[] = [
  { id: 'crawler', label: 'Crawler', icon: Zap, fields: CRAWLER_FIELDS },
  { id: 'alerts', label: 'Alerts', icon: Bell, fields: ALERT_FIELDS },
  { id: 'watchlist', label: 'Watchlist', icon: BookMarked, fields: WATCHLIST_FIELDS },
  { id: 'intelligence', label: 'Signals', icon: Gauge, fields: INTELLIGENCE_FIELDS },
  { id: 'ui', label: 'UI', icon: Eye, fields: UI_FIELDS },
  { id: 'network', label: 'Network', icon: Globe, fields: NETWORK_FIELDS },
  { id: 'notifications', label: 'Notifications', icon: Send },
  { id: 'system', label: 'System', icon: Server },
];

const tabDescriptions: Record<Tab, string> = {
  crawler: 'Tune request cadence, cache pressure, retries, and fallback behavior.',
  alerts: 'Set alert limits, retention, repeat behavior, and default form values.',
  watchlist: 'Control list size, expiry, and automatic symbol housekeeping.',
  intelligence: 'Configure TradePing-only scoring, setup labels, and action hints.',
  ui: 'Choose dashboard refresh behavior and the first view users land on.',
  network: 'Manage API-facing origin settings that affect browser access.',
  notifications: 'Connect Slack or WhatsApp delivery and send test messages.',
  system: 'Review the effective runtime configuration in one compact readout.',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function callsPerMinute(intervalSec: number, cacheTtlSec: number): number {
  if (intervalSec <= 0 || cacheTtlSec <= 0) return 0;
  // Each tick checks the cache; real HTTP fires at most once per cacheTtlSec
  return Math.ceil(60 / Math.max(intervalSec, cacheTtlSec));
}

// ── Component ────────────────────────────────────────────────────────────────
export function SettingsPanel() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [draft, setDraft] = useState<Partial<Omit<SystemSettings, 'port'>>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('crawler');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [slackTestState, setSlackTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [slackTestMsg, setSlackTestMsg] = useState('');
  const [waTestState, setWaTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [waTestMsg, setWaTestMsg] = useState('');

  useEffect(() => {
    api.getSettings()
      .then((res) => setSettings(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isDirty = Object.keys(draft).length > 0;
  const dirtyCount = Object.keys(draft).length;

  const handleChange = (key: keyof Omit<SystemSettings, 'port'>, value: string | number | boolean) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const applyPreset = (name: keyof typeof PRESETS) => {
    setDraft((prev) => ({ ...prev, ...PRESETS[name] }));
  };

  const discard = () => setDraft({});

  const save = async () => {
    if (!isDirty) return;
    setSaveState('saving');
    setErrorMsg('');
    try {
      const res = await api.updateSettings(draft);
      setSettings(res.data);
      setDraft({});
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch (err) {
      setErrorMsg((err as Error).message);
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 4000);
    }
  };

  const getNum = (key: keyof SystemSettings): number =>
    Number(key in draft ? (draft as Record<string, unknown>)[key] : (settings?.[key] ?? 0));

  const getBool = (key: BoolSettingKey): boolean =>
    Boolean(key in draft ? (draft as Record<string, unknown>)[key] : (settings?.[key] ?? false));

  const getText = (key: keyof SystemSettings): string =>
    String(key in draft ? (draft as Record<string, unknown>)[key] : (settings?.[key] ?? ''));

  const activeMeta = TABS.find((t) => t.id === activeTab) ?? TABS[0];
  const fields = activeMeta.fields ?? [];
  const ActiveTabIcon = activeMeta.icon;

  const testChannel = async (channel: 'slack' | 'whatsapp') => {
    const setState = channel === 'slack' ? setSlackTestState : setWaTestState;
    const setMsg = channel === 'slack' ? setSlackTestMsg : setWaTestMsg;
    setState('testing');
    try {
      const res = await api.testNotification(channel);
      setState(res.data.ok ? 'ok' : 'error');
      setMsg(res.data.error ?? '');
    } catch (err) {
      setState('error');
      setMsg((err as Error).message);
    }
    setTimeout(() => { setState('idle'); setMsg(''); }, 4000);
  };

  // Impact estimate (only relevant for crawler tab)
  const effectiveInterval = getNum('crawlerIntervalSeconds') || 5;
  const effectiveCache = getNum('pageCacheTtlSeconds') || 30;
  const cpm = callsPerMinute(effectiveInterval, effectiveCache);

  return (
    <div className="grid gap-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-400/10">
            <Settings2 className="h-4 w-4 text-violet-300" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">System Configuration</h3>
            <p className="text-xs text-white/40">
              <span className="text-emerald-400">LIVE</span> settings apply without restart and persist to{' '}
              <code className="font-mono text-white/50">.env</code>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <AnimatePresence mode="wait">
            {saveState === 'saved' && (
              <motion.span
                key="saved"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </motion.span>
            )}
            {saveState === 'error' && (
              <motion.span
                key="error"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="max-w-[220px] truncate rounded-full bg-red-400/10 px-3 py-1 text-xs font-medium text-red-300"
                title={errorMsg}
              >
                {errorMsg || 'Save failed'}
              </motion.span>
            )}
          </AnimatePresence>

          {isDirty && (
            <span className="rounded-full bg-violet-400/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
              {dirtyCount} unsaved
            </span>
          )}

          <Button variant="secondary" size="sm" onClick={discard} disabled={!isDirty || saveState === 'saving'}>
            <RotateCcw className="h-3.5 w-3.5" />
            Discard
          </Button>
          <Button size="sm" onClick={save} loading={saveState === 'saving'} disabled={!isDirty}>
            <Save className="h-3.5 w-3.5" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[224px_minmax(0,1fr)]">
        {/* Tab bar */}
        <aside className="min-w-0">
          <div
            role="tablist"
            aria-label="Settings categories"
            className="flex gap-1 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/30 p-1 xl:sticky xl:top-5 xl:flex-col xl:overflow-visible"
          >
            {TABS.map(({ id, label, icon: Icon, fields: tf }) => {
              const dirtyInTab = tf?.filter((f) => f.key in draft).length ?? 0;
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={`settings-panel-${id}`}
                  onClick={() => setActiveTab(id)}
                  className={cn(
                    'relative flex h-10 min-w-36 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-medium transition-[background-color,border-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 xl:w-full xl:justify-start',
                    active
                      ? 'border-violet-400/25 bg-violet-400/10 text-white shadow-[inset_3px_0_0_rgba(167,139,250,0.9)]'
                      : 'border-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/75',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{label}</span>
                  {dirtyInTab > 0 && (
                    <span className="ml-auto rounded-full bg-violet-400/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">
                      {dirtyInTab}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-4 flex min-w-0 items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] px-4 py-3">
            <ActiveTabIcon className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-white">{activeMeta.label}</h4>
              <p className="mt-0.5 text-xs leading-relaxed text-white/45">{tabDescriptions[activeTab]}</p>
            </div>
          </div>

          {/* Tab content */}
          <AnimatePresence mode="wait">
            <motion.div
              id={`settings-panel-${activeTab}`}
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeTab}`}
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="grid gap-4"
            >
          {activeTab === 'crawler' && !loading && (
            <>
              {/* Preset strip */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-white/35">Presets</span>
                {(['conservative', 'standard', 'aggressive'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => applyPreset(p)}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold capitalize text-white/60 transition-[background-color,border-color,color] hover:border-violet-400/40 hover:bg-violet-400/10 hover:text-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                  >
                    {p}
                  </button>
                ))}
                {/* Impact estimate */}
                <div className="ml-auto flex items-center gap-1.5 rounded-lg bg-black/30 px-3 py-1.5">
                  <Zap className="h-3 w-3 text-amber-400" />
                  <span className="font-mono text-xs text-white/50">
                    ~<span className="font-semibold text-amber-300">{cpm}</span> HTTP req/min to ShareSansar
                  </span>
                </div>
              </div>

              {/* Fields */}
              <Card className="overflow-hidden p-0">
                <div className="divide-y divide-white/[0.05]">
                  {fields.map((field) => (
                    <SettingRow
                      key={field.key}
                      field={field}
                      numValue={field.kind === 'number' ? getNum(field.key as keyof SystemSettings) : 0}
                      boolValue={field.kind === 'boolean' ? getBool(field.key as BoolSettingKey) : false}
                      textValue={field.kind === 'text' ? getText(field.key as keyof SystemSettings) : ''}
                      dirty={field.key in draft}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              </Card>
            </>
          )}

          {activeTab === 'watchlist' && !loading && (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-white/[0.05]">
                {fields.map((field) => (
                  <SettingRow
                    key={field.key}
                    field={field}
                    numValue={field.kind === 'number' ? getNum(field.key as keyof SystemSettings) : 0}
                    boolValue={field.kind === 'boolean' ? getBool(field.key as BoolSettingKey) : false}
                    textValue={field.kind === 'text' ? getText(field.key as keyof SystemSettings) : ''}
                    dirty={field.key in draft}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </Card>
          )}

          {activeTab === 'intelligence' && !loading && (
            <div className="grid gap-4">
              <div className="grid gap-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.04] p-4 sm:grid-cols-3">
                <SignalPreview label="Edge Score" value="0-100" detail="Combines momentum, range position, and liquidity." />
                <SignalPreview label="Setup Labels" value="Custom" detail="Breakout, dip, liquidity, and risk hints tuned here." />
                <SignalPreview label="Action Context" value="In-modal" detail="Appears where you inspect a symbol and decide what to watch." />
              </div>
              <Card className="overflow-hidden p-0">
                <div className="divide-y divide-white/[0.05]">
                  {fields.map((field) => (
                    <SettingRow
                      key={field.key}
                      field={field}
                      numValue={field.kind === 'number' ? getNum(field.key as keyof SystemSettings) : 0}
                      boolValue={field.kind === 'boolean' ? getBool(field.key as BoolSettingKey) : false}
                      textValue={field.kind === 'text' ? getText(field.key as keyof SystemSettings) : ''}
                      dirty={field.key in draft}
                      onChange={handleChange}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

          {activeTab === 'alerts' && !loading && (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-white/[0.05]">
                {fields.map((field) => (
                  <SettingRow
                    key={field.key}
                    field={field}
                    numValue={field.kind === 'number' ? getNum(field.key as keyof SystemSettings) : 0}
                    boolValue={field.kind === 'boolean' ? getBool(field.key as BoolSettingKey) : false}
                    textValue={field.kind === 'text' ? getText(field.key as keyof SystemSettings) : ''}
                    dirty={field.key in draft}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </Card>
          )}

          {activeTab === 'ui' && !loading && (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-white/[0.05]">
                {fields.map((field) => (
                  <SettingRow
                    key={field.key}
                    field={field}
                    numValue={field.kind === 'number' ? getNum(field.key as keyof SystemSettings) : 0}
                    boolValue={field.kind === 'boolean' ? getBool(field.key as BoolSettingKey) : false}
                    textValue={field.kind === 'text' ? getText(field.key as keyof SystemSettings) : ''}
                    dirty={field.key in draft}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </Card>
          )}

          {activeTab === 'network' && !loading && (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-white/[0.05]">
                {fields.map((field) => (
                  <SettingRow
                    key={field.key}
                    field={field}
                    numValue={0}
                    boolValue={false}
                    textValue={getText(field.key as keyof SystemSettings)}
                    dirty={field.key in draft}
                    onChange={handleChange}
                  />
                ))}
              </div>
            </Card>
          )}

          {activeTab === 'notifications' && !loading && (
            <div className="grid gap-4">
              {/* Slack */}
              <Card className="overflow-hidden p-0">
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4A154B]/40">
                      <Hash className="h-4 w-4 text-[#E01E5A]" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Slack</div>
                      <div className="text-xs text-white/40">Incoming Webhook — sends a message to any channel</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('slackEnabled', !getBool('slackEnabled'))}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                      getBool('slackEnabled')
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : 'border-white/10 bg-white/[0.03] text-white/40 hover:border-white/20 hover:text-white/60',
                    )}
                  >
                    {getBool('slackEnabled') ? <ToggleRight className="h-4 w-4" aria-hidden="true" /> : <ToggleLeft className="h-4 w-4" aria-hidden="true" />}
                    {getBool('slackEnabled') ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <NotifTextField
                  label="Webhook URL"
                  settingKey="slackWebhookUrl"
                  placeholder="https://hooks.slack.com/services/T.../B.../..."
                  secret
                  value={getText('slackWebhookUrl')}
                  dirty={'slackWebhookUrl' in draft}
                  onChange={handleChange}
                />
                <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] px-6 py-3">
                  {slackTestState === 'ok' && <span className="text-xs text-emerald-400">✓ Message sent!</span>}
                  {slackTestState === 'error' && <span className="max-w-[280px] truncate text-xs text-red-400" title={slackTestMsg}>{slackTestMsg || 'Send failed'}</span>}
                  <Button size="sm" variant="secondary" onClick={() => testChannel('slack')} loading={slackTestState === 'testing'}>
                    <Send className="h-3.5 w-3.5" />
                    Test Slack
                  </Button>
                </div>
              </Card>

              {/* WhatsApp */}
              <Card className="overflow-hidden p-0">
                <div className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#25D366]/10">
                      <Smartphone className="h-4 w-4 text-[#25D366]" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">WhatsApp</div>
                      <div className="text-xs text-white/40">Via Twilio WhatsApp API — requires a Twilio account</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleChange('whatsappEnabled', !getBool('whatsappEnabled'))}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
                      getBool('whatsappEnabled')
                        ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                        : 'border-white/10 bg-white/[0.03] text-white/40 hover:border-white/20 hover:text-white/60',
                    )}
                  >
                    {getBool('whatsappEnabled') ? <ToggleRight className="h-4 w-4" aria-hidden="true" /> : <ToggleLeft className="h-4 w-4" aria-hidden="true" />}
                    {getBool('whatsappEnabled') ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
                <div className="divide-y divide-white/[0.05]">
                  <NotifTextField label="Recipient Phone" settingKey="whatsappPhone" placeholder="+977XXXXXXXXXX" value={getText('whatsappPhone')} dirty={'whatsappPhone' in draft} onChange={handleChange} />
                  <NotifTextField label="Twilio From Number" settingKey="whatsappFromNumber" placeholder="+14155238886" value={getText('whatsappFromNumber')} dirty={'whatsappFromNumber' in draft} onChange={handleChange} />
                  <NotifTextField label="Account SID" settingKey="whatsappAccountSid" placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" value={getText('whatsappAccountSid')} dirty={'whatsappAccountSid' in draft} onChange={handleChange} />
                  <NotifTextField label="Auth Token" settingKey="whatsappAuthToken" placeholder="••••••••••••••••••••••••••••••••" secret value={getText('whatsappAuthToken')} dirty={'whatsappAuthToken' in draft} onChange={handleChange} />
                </div>
                <div className="flex items-center justify-end gap-3 border-t border-white/[0.06] px-6 py-3">
                  {waTestState === 'ok' && <span className="text-xs text-emerald-400">✓ Message sent!</span>}
                  {waTestState === 'error' && <span className="max-w-[280px] truncate text-xs text-red-400" title={waTestMsg}>{waTestMsg || 'Send failed'}</span>}
                  <Button size="sm" variant="secondary" onClick={() => testChannel('whatsapp')} loading={waTestState === 'testing'}>
                    <Send className="h-3.5 w-3.5" />
                    Test WhatsApp
                  </Button>
                </div>
              </Card>

              <NotificationDefaults />
            </div>
          )}

          {(loading && activeTab !== 'system') && (
            <Card className="overflow-hidden p-0">
              <div className="divide-y divide-white/[0.05]">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
              </div>
            </Card>
          )}

          {activeTab === 'system' && (
            <SystemInfoPanel settings={settings} loading={loading} />
          )}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>
    </div>
  );
}

// ── SettingRow ────────────────────────────────────────────────────────────────
function SettingRow({
  field,
  numValue,
  boolValue,
  textValue,
  dirty,
  onChange,
}: {
  field: FieldConfig;
  numValue: number;
  boolValue: boolean;
  textValue: string;
  dirty: boolean;
  onChange: (key: keyof Omit<SystemSettings, 'port'>, value: string | number | boolean) => void;
}) {
  return (
    <div
      className={cn(
        'grid items-start gap-6 px-6 py-5 transition-colors sm:grid-cols-[minmax(0,1fr)_auto]',
        dirty ? 'bg-violet-500/[0.05]' : 'hover:bg-white/[0.02]',
      )}
    >
      {/* Label + description */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-white">{field.label}</span>
          {field.hot ? (
            <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">LIVE</span>
          ) : (
            <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">RESTART</span>
          )}
          {dirty && (
            <span className="rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">unsaved</span>
          )}
        </div>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-white/40">{field.description}</p>
        {'warn' in field && field.warn && (
          <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-400/70">
            <Shield className="h-3 w-3 shrink-0" />
            {field.warn}
          </p>
        )}
      </div>

      {/* Control */}
      <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
        {field.kind === 'number' && (
          <>
            {/* Slider */}
            <div className="flex w-full flex-col items-end gap-1.5 sm:w-auto">
              <input
                aria-label={`${field.label} slider`}
                name={`${field.key}Range`}
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={numValue}
                onChange={(e) => onChange(field.key as keyof Omit<SystemSettings, 'port'>, Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/35 sm:w-32"
              />
              <div className="flex w-full items-center justify-end gap-1">
                <input
                  aria-label={field.label}
                  name={field.key}
                  autoComplete="off"
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  value={numValue}
                  onChange={(e) => onChange(field.key as keyof Omit<SystemSettings, 'port'>, Number(e.target.value))}
                  className={cn(
                    'h-8 w-20 rounded-lg border bg-zinc-900/80 px-2 text-right font-mono text-sm text-white transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30',
                    dirty ? 'border-violet-400/60' : 'border-white/10 focus-visible:border-white/25',
                  )}
                />
                <span className="w-12 text-xs text-white/35">{field.unit}</span>
              </div>
            </div>
          </>
        )}

        {field.kind === 'boolean' && (
          <button
            type="button"
            onClick={() => onChange(field.key, !boolValue)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-[background-color,border-color,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
              boolValue
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                : 'border-white/10 bg-white/[0.03] text-white/40 hover:border-white/20 hover:text-white/60',
            )}
          >
            {boolValue ? <ToggleRight className="h-4 w-4" aria-hidden="true" /> : <ToggleLeft className="h-4 w-4" aria-hidden="true" />}
            {boolValue ? 'Enabled' : 'Disabled'}
          </button>
        )}

        {field.kind === 'text' && (
          <input
            aria-label={field.label}
            name={field.key}
            autoComplete="off"
            type="text"
            value={textValue}
            placeholder={'placeholder' in field ? field.placeholder : undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
            className={cn(
              'h-9 w-full rounded-lg border bg-zinc-900/80 px-3 font-mono text-sm text-white transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30 sm:w-64',
              dirty ? 'border-violet-400/60' : 'border-white/10 focus-visible:border-white/25',
            )}
          />
        )}
      </div>
    </div>
  );
}

// ── NotifTextField ────────────────────────────────────────────────────────────
function NotifTextField({
  label,
  settingKey,
  placeholder,
  secret,
  value,
  dirty,
  onChange,
}: {
  label: string;
  settingKey: keyof Omit<SystemSettings, 'port'>;
  placeholder?: string;
  secret?: boolean;
  value: string;
  dirty: boolean;
  onChange: (key: keyof Omit<SystemSettings, 'port'>, value: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={cn('flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6', dirty && 'bg-violet-500/[0.05]')}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-white">{label}</span>
        {dirty && <span className="rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">unsaved</span>}
      </div>
      <div className="flex w-full shrink-0 items-center gap-1.5 sm:w-auto">
        <input
          aria-label={label}
          name={settingKey}
          autoComplete="off"
          type={secret && !show ? 'password' : 'text'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(settingKey, e.target.value)}
          className={cn(
            'h-9 w-full rounded-lg border bg-zinc-900/80 px-3 font-mono text-sm text-white placeholder:text-white/20 transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/30 sm:w-72',
            dirty ? 'border-violet-400/60' : 'border-white/10 focus-visible:border-white/25',
          )}
        />
        {secret && (
          <button
            type="button"
            aria-label={show ? `Hide ${label}` : `Show ${label}`}
            onClick={() => setShow((s) => !s)}
            className="rounded-md p-2 text-white/30 transition-colors hover:text-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
          >
            {show ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ── System info ───────────────────────────────────────────────────────────────
function SystemInfoPanel({ settings, loading }: { settings: SystemSettings | null; loading: boolean }) {
  if (loading) {
    return (
      <Card className="overflow-hidden p-0">
        {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
      </Card>
    );
  }
  const rows: { icon: React.ElementType; label: string; value: string; mono?: boolean }[] = [
    { icon: Server, label: 'API Port', value: String(settings?.port ?? '—') },
    { icon: Database, label: 'Data Source', value: 'sharesansar.com — server-rendered HTML, no auth required' },
    {
      icon: Timer,
      label: 'Effective Crawler',
      value: `${settings?.crawlerIntervalSeconds ?? '—'}s interval · ${settings?.pageCacheTtlSeconds ?? '—'}s cache · ${settings?.crawlerTimeoutSeconds ?? '—'}s timeout · ${settings?.crawlerRetryCount ?? '—'} retries`,
    },
    {
      icon: Clock,
      label: 'Market Hours Filter',
      value: settings?.marketHoursOnly
        ? 'Enabled — evaluates only Sun–Thu 11:00–15:00 NPT'
        : 'Disabled — evaluates 24/7',
    },
    {
      icon: Zap,
      label: 'Symbols per Tick',
      value: settings?.crawlerMaxSymbolsPerTick
        ? `Max ${settings.crawlerMaxSymbolsPerTick} alerts per tick`
        : 'All active alerts evaluated each tick',
    },
    {
      icon: Bell,
      label: 'Alert Rules',
      value: [
        settings?.alertMaxPerSymbol ? `max ${settings.alertMaxPerSymbol}/symbol` : 'unlimited per symbol',
        settings?.alertExpiryHours ? `expire after ${settings.alertExpiryHours}h` : 'never expire',
        settings?.alertAutoDeleteTriggeredMinutes
          ? `triggered removed after ${settings.alertAutoDeleteTriggeredMinutes}min`
          : 'triggered kept forever',
        settings?.alertRepeatAfterMinutes
          ? `repeats every ${settings.alertRepeatAfterMinutes}min`
          : 'one-shot (no repeat)',
      ].join(' · '),
    },
    { icon: Globe, label: 'CORS Origin', value: settings?.frontendUrl ?? '—', mono: true },
    {
      icon: Send,
      label: 'Notifications',
      value: [
        settings?.slackEnabled ? 'Slack ✓' : 'Slack ✗',
        settings?.whatsappEnabled ? 'WhatsApp ✓' : 'WhatsApp ✗',
      ].join(' · '),
    },
    { icon: Wifi, label: 'Runtime', value: typeof window === 'undefined' ? 'SSR' : 'CSR / hydrated' },
    { icon: RefreshCw, label: 'Persist Target', value: 'PostgreSQL — Setting table', mono: true },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="divide-y divide-white/[0.05]">
        {rows.map(({ icon: Icon, label, value, mono }) => (
          <div key={label} className="flex items-start gap-4 px-6 py-4">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-white/25" />
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wider text-white/40">{label}</div>
              <div className={cn('mt-0.5 text-sm text-white/70', mono && 'font-mono')}>{value}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center justify-between gap-6 px-6 py-5">
      <div className="space-y-2">
        <div className="h-3.5 w-40 rounded bg-white/[0.06]" />
        <div className="h-3 w-72 rounded bg-white/[0.04]" />
      </div>
      <div className="h-9 w-28 shrink-0 rounded-lg bg-white/[0.04]" />
    </div>
  );
}

function SignalPreview({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.07] bg-black/25 p-3">
      <div className="text-xs uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-white">{value}</div>
      <p className="mt-1 text-xs leading-relaxed text-white/45">{detail}</p>
    </div>
  );
}
