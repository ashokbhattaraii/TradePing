import type {
  ApiResponse,
  StockAlert,
  StockSymbol,
  CrawlerLog,
  AlertCondition,
  AlertPriority,
} from '@tradeping/types';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'timeout' | 'http' | 'parse',
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get isOffline() {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 10_000, retries = 2, ...init } = opts;
  const method = (init.method ?? 'GET').toUpperCase();
  // Only retry idempotent reads
  const maxAttempts = method === 'GET' ? retries + 1 : 1;

  let lastErr: ApiError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        ...init,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new ApiError(
          body.message ?? `Request failed: ${res.status}`,
          'http',
          res.status,
        );
      }
      try {
        return (await res.json()) as T;
      } catch {
        throw new ApiError('Invalid JSON response from server', 'parse');
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) {
        // Retry only 5xx for idempotent reads
        if (err.kind === 'http' && err.status && err.status >= 500 && attempt < maxAttempts - 1) {
          lastErr = err;
          await sleep(200 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }
      const isAbort = (err as Error)?.name === 'AbortError';
      const apiErr = new ApiError(
        isAbort ? 'Request timed out' : 'Backend unreachable',
        isAbort ? 'timeout' : 'network',
      );
      if (attempt < maxAttempts - 1) {
        lastErr = apiErr;
        await sleep(200 * Math.pow(2, attempt));
        continue;
      }
      throw apiErr;
    }
  }
  throw lastErr ?? new ApiError('Request failed', 'network');
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
  sector?: string;
  source: 'LIVE' | 'MOCK';
  timestamp: string;
}

export interface PricePoint {
  timestamp: string;
  price: number;
}

export interface CrawlerDebugState {
  running: boolean;
  cacheSize: number;
  pageCacheReady: boolean;
  marketHoursMode: boolean;
  lastCheckOk: boolean;
  progress: {
    step: string;
    message: string;
    processed: number;
    total: number;
    currentSymbol: string;
  } | null;
}

export interface SystemSettings {
  crawlerIntervalSeconds: number;
  pageCacheTtlSeconds: number;
  crawlerTimeoutSeconds: number;
  crawlerRetryCount: number;
  marketHoursOnly: boolean;
  crawlerMaxSymbolsPerTick: number;
  crawlerMockOnFetchFail: boolean;
  crawlerPrefetchOnStart: boolean;
  crawlerUserAgent: string;
  crawlerUseProxy: boolean;
  proxyUrl: string;
  enableAdvancedLogging: boolean;
  crawlerLogFailedRequests: boolean;
  uiThemePreference: string;
  alertAutoDeleteTriggeredMinutes: number;
  alertMaxPerSymbol: number;
  alertExpiryHours: number;
  alertRepeatAfterMinutes: number;
  alertDefaultCondition: string;
  alertDefaultPriority: string;
  alertNotifyOnCreate: boolean;
  alertNotifyOnExpiry: boolean;
  watchlistMaxSymbolsPerList: number;
  watchlistSymbolExpiryDays: number;
  watchlistAutoAddAlertSymbol: boolean;
  watchlistAutoRemoveOnAllTriggered: boolean;
  signalEngineEnabled: boolean;
  signalMomentumThresholdPct: number;
  signalLiquidityFloor: number;
  signalBreakoutRangePct: number;
  signalDipRangePct: number;
  signalAutoWatchScore: number;
  uiPollIntervalSeconds: number;
  uiLogsMaxDisplay: number;
  uiDefaultView: string;
  frontendUrl: string;
  slackEnabled: boolean;
  slackWebhookUrl: string;
  slackMessageTemplate: string;
  whatsappEnabled: boolean;
  whatsappPhone: string;
  whatsappFromNumber: string;
  whatsappAccountSid: string;
  whatsappAuthToken: string;
  whatsappMessageTemplate: string;
  notificationCooldownMinutes: number;
  port: number;
}

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
  symbolAddedAt: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const api = {
  health: () => request<{ status: string; service: string }>('/health', { timeoutMs: 4000 }),
  stocks: () => request<ApiResponse<StockSymbol[]>>('/stocks'),
  listAlerts: () => request<ApiResponse<StockAlert[]>>('/alerts'),
  createAlert: (body: { symbol: StockSymbol; targetPrice: number; condition: AlertCondition; priority?: AlertPriority; note?: string }) =>
    request<ApiResponse<StockAlert>>('/alerts', { method: 'POST', body: JSON.stringify(body) }),
  deleteAlert: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/alerts/${id}`, { method: 'DELETE' }),
  logs: () => request<ApiResponse<CrawlerLog[]>>('/logs'),
  prices: () => request<ApiResponse<PriceSummary[]>>('/crawler/prices'),
  priceHistory: (symbol: string, range: '1d' | '5d' | '1mo' = '1d') =>
    request<ApiResponse<PricePoint[]>>(`/crawler/prices/${encodeURIComponent(symbol)}/history?range=${range}`),
  refreshPrices: () =>
    request<ApiResponse<PriceSummary[]>>('/crawler/prices/refresh', { method: 'POST', timeoutMs: 30_000 }),
  runCheck: () => request<ApiResponse<{ count: number }>>('/crawler/check', { method: 'POST', timeoutMs: 30_000 }),
  getDebugState: () => request<ApiResponse<CrawlerDebugState>>('/crawler/debug/state'),
  clearCrawlerCache: () => request<ApiResponse<{ message: string }>>('/crawler/debug/clear-cache', { method: 'POST' }),
  getSettings: () => request<ApiResponse<SystemSettings>>('/settings'),
  updateSettings: (patch: Partial<Omit<SystemSettings, 'port'>>) =>
    request<ApiResponse<SystemSettings>>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  testNotification: (channel: 'slack' | 'whatsapp') =>
    request<ApiResponse<{ ok: boolean; error?: string }>>(`/notifications/test/${channel}`, { method: 'POST' }),
  // ── Watchlists ───────────────────────────────────────────────────────────
  listWatchlists: () => request<ApiResponse<Watchlist[]>>('/watchlists'),
  createWatchlist: (name: string) =>
    request<ApiResponse<Watchlist>>('/watchlists', { method: 'POST', body: JSON.stringify({ name }) }),
  renameWatchlist: (id: string, name: string) =>
    request<ApiResponse<Watchlist>>(`/watchlists/${id}/rename`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteWatchlist: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/watchlists/${id}`, { method: 'DELETE' }),
  addToWatchlist: (id: string, symbol: string) =>
    request<ApiResponse<Watchlist>>(`/watchlists/${id}/symbols`, { method: 'POST', body: JSON.stringify({ symbol }) }),
  removeFromWatchlist: (id: string, symbol: string) =>
    request<ApiResponse<Watchlist>>(`/watchlists/${id}/symbols/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),
  // ── Database management ─────────────────────────────────────────────────
  listDbTables: () => request<ApiResponse<DbTableSummary[]>>('/database/tables'),
  getDbStats: () => request<ApiResponse<Record<string, number>>>('/database/stats'),
  getDbTableSchema: (name: string) =>
    request<ApiResponse<DbTableSchema>>(`/database/tables/${encodeURIComponent(name)}/schema`),
  listDbRows: (
    name: string,
    opts: { page?: number; limit?: number; search?: string; sortField?: string; sortDir?: 'asc' | 'desc' } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.search) params.set('search', opts.search);
    if (opts.sortField) params.set('sortField', opts.sortField);
    if (opts.sortDir) params.set('sortDir', opts.sortDir);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<DbRowsResponse>(`/database/tables/${encodeURIComponent(name)}${qs}`);
  },
  exportDbRows: (
    name: string,
    opts: { search?: string; sortField?: string; sortDir?: 'asc' | 'desc' } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.sortField) params.set('sortField', opts.sortField);
    if (opts.sortDir) params.set('sortDir', opts.sortDir);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<ApiResponse<Record<string, unknown>[]>>(
      `/database/tables/${encodeURIComponent(name)}/export${qs}`,
    );
  },
  createDbRow: (name: string, body: Record<string, unknown>) =>
    request<ApiResponse<Record<string, unknown>>>(`/database/tables/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateDbRow: (name: string, id: string, body: Record<string, unknown>) =>
    request<ApiResponse<Record<string, unknown>>>(
      `/database/tables/${encodeURIComponent(name)}/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) },
    ),
  deleteDbRow: (name: string, id: string) =>
    request<ApiResponse<{ id: string }>>(
      `/database/tables/${encodeURIComponent(name)}/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
  bulkDeleteDbRows: (name: string, ids: string[]) =>
    request<ApiResponse<{ deleted: number }>>(
      `/database/tables/${encodeURIComponent(name)}/bulk-delete`,
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),
  // ── Notification rules + template defaults ──────────────────────────────
  listNotificationRules: () => request<ApiResponse<NotificationRuleSummary[]>>('/notifications/rules'),
  listNotificationTemplates: () =>
    request<ApiResponse<NotificationTemplateSummary[]>>('/notifications/templates'),
  getDefaultNotificationTemplates: () =>
    request<ApiResponse<Record<string, string>>>('/notifications/templates/defaults'),
  listNotificationChannels: () =>
    request<ApiResponse<NotificationChannelSummary[]>>('/notifications/channels'),
};

export interface NotificationRuleSummary {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  priority: number;
  filters: Record<string, unknown>;
  channelId: string;
  templateId: string | null;
  cooldownMin: number;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplateSummary {
  id: string;
  name: string;
  event: string;
  channelId: string | null;
  body: string;
  subject: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationChannelSummary {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export type DbColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json' | 'string[]';

export interface DbColumn {
  name: string;
  type: DbColumnType;
  isId?: boolean;
  isReadonly?: boolean;
  optional?: boolean;
  enumValues?: string[];
}

export interface DbTableSummary {
  name: string;
  label: string;
  description: string;
  prismaModel: string;
  idField: string;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };
  searchableFields: string[];
}

export interface DbTableSchema extends DbTableSummary {
  columns: DbColumn[];
}

export interface DbRowsResponse {
  success: boolean;
  data: Record<string, unknown>[];
  meta: { total: number; page: number; limit: number };
}
