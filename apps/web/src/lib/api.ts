import type {
  ApiResponse,
  StockAlert,
  StockSymbol,
  CrawlerLog,
  AlertCondition,
  AlertPriority,
} from '@tradeping/types';
import { clearAuthToken, getAuthToken } from './auth-token';

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
      const token = getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers as Record<string, string> | undefined),
      };
      const res = await fetch(`${API_BASE}${path}`, {
        cache: 'no-store',
        signal: controller.signal,
        ...init,
        headers,
      });
      clearTimeout(timer);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        if (res.status === 401 && !path.startsWith('/auth/')) {
          clearAuthToken();
        }
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
  name?: string;
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

export interface PreviewPrice {
  symbol: string;
  name?: string;
  price: number;
  change: number;
  changePct: number;
  sector: string;
  source: 'LIVE' | 'MOCK';
  timestamp: string;
}

export interface PricePoint {
  timestamp: string;
  price: number;
}

export type CrawlStepStatus = 'pending' | 'running' | 'done' | 'warning' | 'error';

export interface CrawlPredictionStep {
  id: string;
  label: string;
  source?: string;
  url?: string;
  status: CrawlStepStatus;
  detail: string;
  durationMs?: number;
}

export interface CrawlSourceConfig {
  id: string;
  label: string;
  source: string;
  url: string;
  custom?: boolean;
}

export interface CrawlSourceReport {
  id: string;
  source: string;
  url: string;
  status: CrawlStepStatus;
  noticesFound: number;
  bytesRead: number;
  attempts: number;
  durationMs: number;
  error?: string;
}

export interface CrawlNotice {
  source: string;
  title: string;
  url?: string;
  snippet: string;
  matchedSymbols: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface StockPrediction {
  symbol: string;
  name?: string;
  verdict: 'BULLISH' | 'WATCH' | 'NEUTRAL' | 'RISK';
  confidence: number;
  score: number;
  price?: number;
  changePct?: number;
  volume?: number;
  turnover?: number;
  sector?: string;
  notices: CrawlNotice[];
  reasons: string[];
}

export interface StockMeta {
  symbol: string;
  name: string;
}

export interface CrawlPredictionReport {
  requestedSymbols: string[];
  generatedAt: string;
  steps: CrawlPredictionStep[];
  predictions: StockPrediction[];
  summary: string;
  mode?: 'single' | 'comparison' | 'batch';
  winner?: string;
  sources: CrawlSourceConfig[];
  sourceReports: CrawlSourceReport[];
}

export interface BrokerParticipant {
  broker: string;
  quantity: number;
  amount: number;
  sharePct: number;
}

export interface BrokerTrade {
  transactionNo: string;
  buyer: string;
  seller: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface StockCommandReport {
  symbol: string;
  name?: string;
  generatedAt: string;
  price: PriceSummary | null;
  movement: {
    direction: 'up' | 'down' | 'flat';
    label: string;
    changePct: number;
    dayRangePct: number;
    volatilityPct: number;
    samples: number;
  };
  sectorComparison: {
    sector: string;
    peers: number;
    sectorAverageChangePct: number;
    rankByChange: number | null;
    rankByTurnover: number | null;
    leaders: Pick<PriceSummary, 'symbol' | 'name' | 'changePct' | 'turnover'>[];
  };
  brokerActivity: {
    status: 'live' | 'limited' | 'unavailable';
    source: string;
    url: string;
    trades: number;
    totalQuantity: number;
    totalAmount: number;
    averageRate: number;
    concentrationPct: number;
    topBuyers: BrokerParticipant[];
    topSellers: BrokerParticipant[];
    sampleTrades: BrokerTrade[];
    summary: string;
  };
  notices: CrawlNotice[];
  risk: {
    level: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
    score: number;
    factors: string[];
  };
  confidence: {
    score: number;
    label: 'LOW' | 'MEDIUM' | 'HIGH';
    coverage: string[];
  };
  whyMoving: string[];
  suggestedPlan: {
    stance: 'WATCH' | 'ALERT' | 'AVOID' | 'REVIEW';
    summary: string;
    alertIdeas: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }[];
  };
  prediction: StockPrediction | null;
  sourceReports: CrawlSourceReport[];
}

export interface PreTradeRiskReport {
  symbol: string;
  name?: string;
  generatedAt: string;
  input: {
    amount: number;
    holdingDays: number;
  };
  price: PriceSummary | null;
  estimatedUnits: number;
  estimatedCost: number;
  downsideScenarios: {
    label: string;
    movePct: number;
    estimatedPrice: number;
    estimatedLoss: number;
    lossPct: number;
  }[];
  liquidityRisk: {
    level: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
    score: number;
    dailyTurnoverCoveragePct: number;
    volumeParticipationPct: number;
    estimatedExitDays: number;
    maxComfortablePosition: number;
    reasons: string[];
  };
  sectorRisk: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    relativePerformancePct: number;
    rankByChange: number | null;
    peers: number;
    summary: string;
  };
  noticeRisk: {
    level: 'LOW' | 'MODERATE' | 'HIGH';
    positive: number;
    neutral: number;
    negative: number;
    summary: string;
    notices: CrawlNotice[];
  };
  overall: {
    decision: 'PASS' | 'WAIT' | 'SMALL_POSITION' | 'AVOID';
    level: 'LOW' | 'MODERATE' | 'HIGH' | 'EXTREME';
    score: number;
    summary: string;
  };
  alertPlan: { condition: 'ABOVE' | 'BELOW'; targetPrice: number; reason: string }[];
  assumptions: string[];
  evidence: string[];
}

export type UserRole = string;
export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED';

export interface AuthUser {
  id: string;
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
  status?: UserStatus;
  permissions?: string[];
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: string;
  status: UserStatus;
  permissionsGrant: string[];
  permissionsRevoke: string[];
  effectivePermissions: string[];
  lastLoginAt: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoleSummary {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  permissions: string[];
  userCount: number;
}

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export interface RolesResponse {
  catalog: PermissionDef[];
  roles: RoleSummary[];
}

export interface UserStatsResponse {
  total: number;
  activeLast7Days: number;
  byStatus: Record<string, number>;
  byRole: Record<string, number>;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  expiresAt: string;
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
  loginWithGoogle: (credential: string) =>
    request<ApiResponse<AuthSession>>('/auth/google', { method: 'POST', body: JSON.stringify({ credential }) }),
  me: () => request<ApiResponse<AuthUser>>('/auth/me', { retries: 0 }),
  logout: () => request<ApiResponse<{ ok: boolean }>>('/auth/logout', { method: 'POST' }),
  health: () => request<{ status: string; service: string }>('/health', { timeoutMs: 4000 }),
  stocks: () => request<ApiResponse<StockSymbol[]>>('/stocks'),
  stocksMeta: () => request<ApiResponse<StockMeta[]>>('/stocks/meta'),
  listAlerts: () => request<ApiResponse<StockAlert[]>>('/alerts'),
  createAlert: (body: { symbol: StockSymbol; targetPrice: number; condition: AlertCondition; priority?: AlertPriority; note?: string }) =>
    request<ApiResponse<StockAlert>>('/alerts', { method: 'POST', body: JSON.stringify(body) }),
  deleteAlert: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/alerts/${id}`, { method: 'DELETE' }),
  logs: () => request<ApiResponse<CrawlerLog[]>>('/logs'),
  prices: () => request<ApiResponse<PriceSummary[]>>('/crawler/prices'),
  pricesPreview: (limit = 10) =>
    request<ApiResponse<PreviewPrice[]>>(`/crawler/prices/preview?limit=${limit}`, { retries: 1, timeoutMs: 6000 }),
  priceHistory: (symbol: string, range: '1d' | '5d' | '1mo' = '1d') =>
    request<ApiResponse<PricePoint[]>>(`/crawler/prices/${encodeURIComponent(symbol)}/history?range=${range}`),
  stockCommand: (symbol: string) =>
    request<ApiResponse<StockCommandReport>>(`/crawler/command/${encodeURIComponent(symbol)}`, { timeoutMs: 150_000 }),
  preTradeRisk: (body: { symbol: string; amount: number; holdingDays: number }) =>
    request<ApiResponse<PreTradeRiskReport>>('/crawler/pretrade', {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs: 150_000,
    }),
  predictStocks: (symbols: string[], sourceIds?: string[], customSources?: { label?: string; url: string }[]) =>
    request<ApiResponse<CrawlPredictionReport>>('/crawler/predict', {
      method: 'POST',
      body: JSON.stringify({ symbols, sourceIds, customSources }),
      timeoutMs: 120_000,
    }),
  predictStock: (symbol: string, sourceIds?: string[], customSources?: { label?: string; url: string }[]) =>
    request<ApiResponse<CrawlPredictionReport>>('/crawler/predict/single', {
      method: 'POST',
      body: JSON.stringify({ symbol, sourceIds, customSources }),
      timeoutMs: 120_000,
    }),
  compareStocks: (symbols: string[], sourceIds?: string[], customSources?: { label?: string; url: string }[]) =>
    request<ApiResponse<CrawlPredictionReport>>('/crawler/compare', {
      method: 'POST',
      body: JSON.stringify({ symbols, sourceIds, customSources }),
      timeoutMs: 180_000,
    }),
  refreshPrices: () =>
    request<ApiResponse<PriceSummary[]>>('/crawler/prices/refresh', { method: 'POST', timeoutMs: 30_000 }),
  runCheck: () => request<ApiResponse<{ count: number }>>('/crawler/check', { method: 'POST', timeoutMs: 30_000 }),
  getDebugState: () => request<ApiResponse<CrawlerDebugState>>('/crawler/debug/state'),
  clearCrawlerCache: () => request<ApiResponse<{ message: string }>>('/crawler/debug/clear-cache', { method: 'POST' }),
  getSettings: () => request<ApiResponse<SystemSettings>>('/settings'),
  updateSettings: (patch: Partial<Omit<SystemSettings, 'port'>>) =>
    request<ApiResponse<SystemSettings>>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  testNotification: (
    channel: 'slack' | 'whatsapp',
    body: {
      slackWebhookUrl?: string;
      whatsappAccountSid?: string;
      whatsappAuthToken?: string;
      whatsappFromNumber?: string;
      whatsappPhone?: string;
    } = {},
  ) =>
    request<ApiResponse<{ ok: boolean; error?: string }>>(`/notifications/test/${channel}`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
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
  // ── Admin: users ────────────────────────────────────────────────────────
  listAdminUsers: (opts: { search?: string; role?: string; status?: UserStatus; page?: number; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.search) params.set('search', opts.search);
    if (opts.role) params.set('role', opts.role);
    if (opts.status) params.set('status', opts.status);
    if (opts.page) params.set('page', String(opts.page));
    if (opts.limit) params.set('limit', String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<{ success: boolean; data: AdminUser[]; meta: { total: number; page: number; limit: number } }>(
      `/admin/users${qs}`,
    );
  },
  getAdminUserStats: () => request<ApiResponse<UserStatsResponse>>('/admin/users/stats'),
  getAdminUser: (id: string) => request<ApiResponse<AdminUser>>(`/admin/users/${encodeURIComponent(id)}`),
  updateAdminUser: (id: string, body: { role?: string; status?: UserStatus; name?: string }) =>
    request<ApiResponse<AdminUser>>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  setAdminUserPermissions: (id: string, body: { grants?: string[]; revokes?: string[] }) =>
    request<ApiResponse<AdminUser>>(`/admin/users/${encodeURIComponent(id)}/permissions`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  inviteAdminUser: (body: { email: string; role?: string; name?: string }) =>
    request<ApiResponse<AdminUser>>('/admin/users/invite', { method: 'POST', body: JSON.stringify(body) }),
  deleteAdminUser: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ── Admin: roles ────────────────────────────────────────────────────────
  listAdminRoles: () => request<ApiResponse<RolesResponse>>('/admin/roles'),
  createAdminRole: (body: { key: string; name: string; description?: string; permissions?: string[]; rank?: number }) =>
    request<ApiResponse<RoleSummary>>('/admin/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminRole: (
    key: string,
    body: { name?: string; description?: string; permissions?: string[]; rank?: number },
  ) =>
    request<ApiResponse<RoleSummary>>(`/admin/roles/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAdminRole: (key: string) =>
    request<ApiResponse<{ key: string }>>(`/admin/roles/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  bulkDeleteDbRows: (name: string, ids: string[]) =>
    request<ApiResponse<{ deleted: number }>>(
      `/database/tables/${encodeURIComponent(name)}/bulk-delete`,
      { method: 'POST', body: JSON.stringify({ ids }) },
    ),
  // ── Notification rules + template defaults ──────────────────────────────
  listNotificationRules: () => request<ApiResponse<NotificationRuleSummary[]>>('/notifications/rules'),
  createNotificationRule: (body: NotificationRuleInput) =>
    request<ApiResponse<NotificationRuleSummary>>('/notifications/rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNotificationRule: (id: string, body: Partial<NotificationRuleInput>) =>
    request<ApiResponse<NotificationRuleSummary>>(`/notifications/rules/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteNotificationRule: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/notifications/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listNotificationTemplates: () =>
    request<ApiResponse<NotificationTemplateSummary[]>>('/notifications/templates'),
  createNotificationTemplate: (body: NotificationTemplateInput) =>
    request<ApiResponse<NotificationTemplateSummary>>('/notifications/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNotificationTemplate: (id: string, body: Partial<NotificationTemplateInput>) =>
    request<ApiResponse<NotificationTemplateSummary>>(`/notifications/templates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteNotificationTemplate: (id: string) =>
    request<ApiResponse<{ id: string }>>(`/notifications/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  previewNotificationTemplate: (body: { body: string; event?: string }) =>
    request<ApiResponse<{ rendered: string }>>('/notifications/templates/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getDefaultNotificationTemplates: () =>
    request<ApiResponse<Record<string, string>>>('/notifications/templates/defaults'),
  listNotificationChannels: () =>
    request<ApiResponse<NotificationChannelSummary[]>>('/notifications/channels'),
  createNotificationChannel: (body: NotificationChannelInput) =>
    request<ApiResponse<NotificationChannelSummary>>('/notifications/channels', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateNotificationChannel: (id: string, body: Partial<NotificationChannelInput>) =>
    request<ApiResponse<NotificationChannelSummary>>(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
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

export interface NotificationRuleInput {
  name: string;
  event: string;
  enabled?: boolean;
  priority?: number;
  filters?: Record<string, unknown>;
  channelId: string;
  templateId?: string | null;
  cooldownMin?: number;
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

export interface NotificationTemplateInput {
  name: string;
  event: string;
  channelId?: string | null;
  body: string;
  subject?: string | null;
  isDefault?: boolean;
}

export interface NotificationChannelSummary {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface NotificationChannelInput {
  name: string;
  type: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
}

export type DbColumnType = 'string' | 'number' | 'boolean' | 'datetime' | 'json' | 'string[]';

export interface DbColumn {
  adminOnly?: boolean;
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
  ownerScoped?: boolean;
  ownerField?: string;
  noCreate?: boolean;
  noDelete?: boolean;
}

export interface DbTableSchema extends DbTableSummary {
  columns: DbColumn[];
}

export interface DbRowsResponse {
  success: boolean;
  data: Record<string, unknown>[];
  meta: { total: number; page: number; limit: number };
}
