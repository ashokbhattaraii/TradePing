import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

import { LogsService } from '../logs/logs.service';
import { CrawlerService } from '../crawler/crawler.service';
import { AlertsService } from '../alerts/alerts.service';

export interface SystemSettings {
  // ── Crawler ──────────────────────────────────────────────────────────────
  crawlerIntervalSeconds: number;
  pageCacheTtlSeconds: number;
  crawlerTimeoutSeconds: number;
  crawlerRetryCount: number;
  marketHoursOnly: boolean;
  crawlerMaxSymbolsPerTick: number;
  /** Fall back to mock prices when live fetch fails (true = mock, false = throw error) */
  crawlerMockOnFetchFail: boolean;
  /** Warm up price cache immediately on server start */
  crawlerPrefetchOnStart: boolean;
  /** User-Agent header sent to ShareSansar */
  crawlerUserAgent: string;
  // ── More Configuration ───────────────────────────────────────────────────
  /** Enable Proxy usage for crawler */
  crawlerUseProxy: boolean;
  /** Proxy URL to use */
  proxyUrl: string;
  /** Advanced logging mode */
  enableAdvancedLogging: boolean;
  /** Log failed fetch requests deeply */
  crawlerLogFailedRequests: boolean;
  /** Preferred UI Theme */
  uiThemePreference: string;
  // ── Alerts ───────────────────────────────────────────────────────────────
  alertAutoDeleteTriggeredMinutes: number;
  alertMaxPerSymbol: number;
  alertExpiryHours: number;
  alertRepeatAfterMinutes: number;
  /** Default condition pre-filled when creating a new alert */
  alertDefaultCondition: string;
  /** Default priority pre-filled when creating a new alert */
  alertDefaultPriority: string;
  /** Send a notification when a new alert is created */
  alertNotifyOnCreate: boolean;
  /** Send a notification when an alert expires */
  alertNotifyOnExpiry: boolean;
  // ── Watchlist ─────────────────────────────────────────────────────────────
  watchlistMaxSymbolsPerList: number;
  watchlistSymbolExpiryDays: number;
  watchlistAutoAddAlertSymbol: boolean;
  watchlistAutoRemoveOnAllTriggered: boolean;
  // ── TradePing Signal Engine ────────────────────────────────────────────────
  /** Enable TradePing's own edge scoring and action hints in the UI */
  signalEngineEnabled: boolean;
  /** Change % that marks a momentum setup */
  signalMomentumThresholdPct: number;
  /** Minimum turnover for a liquid setup */
  signalLiquidityFloor: number;
  /** Range position % that marks a breakout watch */
  signalBreakoutRangePct: number;
  /** Range position % that marks a dip watch */
  signalDipRangePct: number;
  /** Auto-watch symbols with an edge score at or above this value. 0 = off */
  signalAutoWatchScore: number;
  // ── UI ───────────────────────────────────────────────────────────────────
  /** Poll interval for alerts/logs/prices on the frontend (seconds) */
  uiPollIntervalSeconds: number;
  /** Max log entries shown in the UI */
  uiLogsMaxDisplay: number;
  /** Panel that opens by default: prices | alerts | logs | watchlist | settings */
  uiDefaultView: string;
  // ── Network ───────────────────────────────────────────────────────────────
  frontendUrl: string;
  // ── Notifications ─────────────────────────────────────────────────────────
  slackEnabled: boolean;
  slackWebhookUrl: string;
  /** Custom Slack message template — {{symbol}}, {{condition}}, {{target}}, {{price}}, {{note}} */
  slackMessageTemplate: string;
  whatsappEnabled: boolean;
  whatsappPhone: string;
  whatsappFromNumber: string;
  whatsappAccountSid: string;
  whatsappAuthToken: string;
  /** Custom WhatsApp message template — same tokens as Slack */
  whatsappMessageTemplate: string;
  /** Minimum gap (minutes) between repeated notifications for the same alert (0 = no cooldown) */
  notificationCooldownMinutes: number;
  port: number;
}

type SettingKey = Exclude<keyof SystemSettings, 'port'>;

/**
 * Keys that affect shared system services (the crawler process, CORS, port).
 * These are stored in the global `Setting` table and applied process-wide.
 * Everything else is per-user and stored in `UserSetting`.
 */
const SYSTEM_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'crawlerIntervalSeconds',
  'pageCacheTtlSeconds',
  'crawlerTimeoutSeconds',
  'crawlerRetryCount',
  'marketHoursOnly',
  'crawlerMaxSymbolsPerTick',
  'crawlerMockOnFetchFail',
  'crawlerPrefetchOnStart',
  'crawlerUserAgent',
  'crawlerUseProxy',
  'proxyUrl',
  'enableAdvancedLogging',
  'crawlerLogFailedRequests',
  'frontendUrl',
]);

const BOOL_KEYS: SettingKey[] = [
  'marketHoursOnly',
  'crawlerMockOnFetchFail',
  'crawlerPrefetchOnStart',
  'alertNotifyOnCreate',
  'alertNotifyOnExpiry',
  'watchlistAutoAddAlertSymbol',
  'watchlistAutoRemoveOnAllTriggered',
  'signalEngineEnabled',
  'slackEnabled',
  'whatsappEnabled',
  'crawlerUseProxy',
  'enableAdvancedLogging',
  'crawlerLogFailedRequests',
];

const STRING_KEYS: SettingKey[] = [
  'crawlerUserAgent',
  'alertDefaultCondition',
  'alertDefaultPriority',
  'uiDefaultView',
  'frontendUrl',
  'slackWebhookUrl',
  'slackMessageTemplate',
  'whatsappPhone',
  'whatsappFromNumber',
  'whatsappAccountSid',
  'whatsappAuthToken',
  'whatsappMessageTemplate',
  'proxyUrl',
  'uiThemePreference',
];

@Injectable()
export class SettingsService implements OnModuleInit {
  private current: SystemSettings;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CrawlerService)) private readonly crawler: CrawlerService,
    @Inject(forwardRef(() => AlertsService)) private readonly alerts: AlertsService,
    @Inject(forwardRef(() => LogsService)) private readonly logs: LogsService,
  ) {
    // Defaults from env — will be overridden by DB values in onModuleInit
    this.current = {
      crawlerIntervalSeconds: Number(this.config.get('CRAWLER_INTERVAL_SECONDS') ?? 5),
      pageCacheTtlSeconds: Number(this.config.get('PAGE_CACHE_TTL_SECONDS') ?? 30),
      crawlerTimeoutSeconds: Number(this.config.get('CRAWLER_TIMEOUT_SECONDS') ?? 15),
      crawlerRetryCount: Number(this.config.get('CRAWLER_RETRY_COUNT') ?? 2),
      marketHoursOnly: this.config.get('MARKET_HOURS_ONLY') === 'true',
      crawlerMaxSymbolsPerTick: Number(this.config.get('CRAWLER_MAX_SYMBOLS_PER_TICK') ?? 0),
      crawlerMockOnFetchFail: this.config.get('CRAWLER_MOCK_ON_FETCH_FAIL') !== 'false',
      crawlerPrefetchOnStart: this.config.get('CRAWLER_PREFETCH_ON_START') !== 'false',
      crawlerUserAgent: this.config.get<string>('CRAWLER_USER_AGENT') ?? 'Mozilla/5.0 (compatible; TradePing/1.0)',
      crawlerUseProxy: this.config.get('CRAWLER_USE_PROXY') === 'true',
      proxyUrl: this.config.get<string>('PROXY_URL') ?? '',
      enableAdvancedLogging: this.config.get('ENABLE_ADVANCED_LOGGING') === 'true',
      crawlerLogFailedRequests: this.config.get('CRAWLER_LOG_FAILED_REQUESTS') === 'true',
      uiThemePreference: this.config.get<string>('UI_THEME_PREFERENCE') ?? 'system',
      alertAutoDeleteTriggeredMinutes: Number(this.config.get('ALERT_AUTO_DELETE_TRIGGERED_MINUTES') ?? 0),
      alertMaxPerSymbol: Number(this.config.get('ALERT_MAX_PER_SYMBOL') ?? 0),
      alertExpiryHours: Number(this.config.get('ALERT_EXPIRY_HOURS') ?? 0),
      alertRepeatAfterMinutes: Number(this.config.get('ALERT_REPEAT_AFTER_MINUTES') ?? 0),
      alertDefaultCondition: this.config.get<string>('ALERT_DEFAULT_CONDITION') ?? 'ABOVE',
      alertDefaultPriority: this.config.get<string>('ALERT_DEFAULT_PRIORITY') ?? 'MEDIUM',
      alertNotifyOnCreate: this.config.get('ALERT_NOTIFY_ON_CREATE') === 'true',
      alertNotifyOnExpiry: this.config.get('ALERT_NOTIFY_ON_EXPIRY') === 'true',
      watchlistMaxSymbolsPerList: Number(this.config.get('WATCHLIST_MAX_SYMBOLS_PER_LIST') ?? 100),
      watchlistSymbolExpiryDays: Number(this.config.get('WATCHLIST_SYMBOL_EXPIRY_DAYS') ?? 0),
      watchlistAutoAddAlertSymbol: this.config.get('WATCHLIST_AUTO_ADD_ALERT_SYMBOL') === 'true',
      watchlistAutoRemoveOnAllTriggered: this.config.get('WATCHLIST_AUTO_REMOVE_ON_ALL_TRIGGERED') === 'true',
      signalEngineEnabled: this.config.get('SIGNAL_ENGINE_ENABLED') !== 'false',
      signalMomentumThresholdPct: Number(this.config.get('SIGNAL_MOMENTUM_THRESHOLD_PCT') ?? 2),
      signalLiquidityFloor: Number(this.config.get('SIGNAL_LIQUIDITY_FLOOR') ?? 500000),
      signalBreakoutRangePct: Number(this.config.get('SIGNAL_BREAKOUT_RANGE_PCT') ?? 80),
      signalDipRangePct: Number(this.config.get('SIGNAL_DIP_RANGE_PCT') ?? 25),
      signalAutoWatchScore: Number(this.config.get('SIGNAL_AUTO_WATCH_SCORE') ?? 0),
      uiPollIntervalSeconds: Number(this.config.get('UI_POLL_INTERVAL_SECONDS') ?? 5),
      uiLogsMaxDisplay: Number(this.config.get('UI_LOGS_MAX_DISPLAY') ?? 200),
      uiDefaultView: this.config.get<string>('UI_DEFAULT_VIEW') ?? 'overview',
      frontendUrl: this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:3000',
      slackEnabled: this.config.get('SLACK_ENABLED') === 'true',
      slackWebhookUrl: this.config.get<string>('SLACK_WEBHOOK_URL') ?? '',
      slackMessageTemplate: this.config.get<string>('SLACK_MESSAGE_TEMPLATE') ?? '🔔 *{{symbol}}* hit target — {{condition}} Rs.{{target}} · now Rs.{{price}}{{#note}} ({{note}}){{/note}}',
      whatsappEnabled: this.config.get('WHATSAPP_ENABLED') === 'true',
      whatsappPhone: this.config.get<string>('WHATSAPP_PHONE') ?? '',
      whatsappFromNumber: this.config.get<string>('WHATSAPP_FROM_NUMBER') ?? '',
      whatsappAccountSid: this.config.get<string>('WHATSAPP_ACCOUNT_SID') ?? '',
      whatsappAuthToken: this.config.get<string>('WHATSAPP_AUTH_TOKEN') ?? '',
      whatsappMessageTemplate: this.config.get<string>('WHATSAPP_MESSAGE_TEMPLATE') ?? '🔔 *{{symbol}}* hit target — {{condition}} Rs.{{target}} · now Rs.{{price}}{{#note}} ({{note}}){{/note}}',
      notificationCooldownMinutes: Number(this.config.get('NOTIFICATION_COOLDOWN_MINUTES') ?? 0),
      port: Number(this.config.get('PORT') ?? 4000),
    };
  }

  async onModuleInit() {
    // Load persisted global settings from DB, overriding env defaults
    const rows = await this.prisma.setting.findMany({ where: { userId: null } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    this.current = { ...this.current, ...this.parsePatch(map) };

    // Broadcast initial settings to services
    this.pushSettings();
    this.logs.info('Settings built from DB and applied safely');
  }

  private parsePatch(map: Record<string, string>): Partial<SystemSettings> {
    const patch: Partial<SystemSettings> = {};
    for (const [k, v] of Object.entries(map)) {
      if (k === 'port') continue;
      const key = k as SettingKey;
      if (BOOL_KEYS.includes(key)) {
        (patch as Record<string, unknown>)[key] = v === 'true';
      } else if (STRING_KEYS.includes(key)) {
        (patch as Record<string, unknown>)[key] = v;
      } else {
        (patch as Record<string, unknown>)[key] = Number(v);
      }
    }
    return patch;
  }

  private pushSettings() {
    this.crawler.applySettings({
      intervalSeconds: this.current.crawlerIntervalSeconds,
      pageCacheTtlMs: this.current.pageCacheTtlSeconds * 1000,
      timeoutMs: this.current.crawlerTimeoutSeconds * 1000,
      retryCount: this.current.crawlerRetryCount,
      marketHoursOnly: this.current.marketHoursOnly,
      maxSymbolsPerTick: this.current.crawlerMaxSymbolsPerTick,
      userAgent: this.current.crawlerUserAgent,
      mockOnFetchFail: this.current.crawlerMockOnFetchFail,
    });
    this.alerts.applyAlertSettings({
      autoDeleteTriggeredMinutes: this.current.alertAutoDeleteTriggeredMinutes,
      maxPerSymbol: this.current.alertMaxPerSymbol,
      expiryHours: this.current.alertExpiryHours,
      repeatAfterMinutes: this.current.alertRepeatAfterMinutes,
      notifyOnCreate: this.current.alertNotifyOnCreate,
      notifyOnExpiry: this.current.alertNotifyOnExpiry,
    });
  }

  /** Global settings (used by crawler/system process). */
  get(): SystemSettings {
    return { ...this.current };
  }

  /** Effective settings for a specific user: global merged with their overrides. */
  async getForUser(userId: string): Promise<SystemSettings> {
    const rows = await this.prisma.userSetting.findMany({ where: { userId } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...this.current, ...this.parsePatch(map) };
  }

  /**
   * Update settings for a user. System keys go to the global Setting table
   * (and are applied to the running crawler/alert services). User-facing keys
   * go to that user's UserSetting overrides.
   */
  async updateForUser(
    userId: string,
    patch: Partial<Omit<SystemSettings, 'port'>>,
  ): Promise<SystemSettings> {
    const systemPatch: Record<string, unknown> = {};
    const userPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'port') continue;
      if (SYSTEM_KEYS.has(k as SettingKey)) systemPatch[k] = v;
      else userPatch[k] = v;
    }

    if (Object.keys(systemPatch).length > 0) {
      this.current = { ...this.current, ...(systemPatch as Partial<SystemSettings>) };
      await this.persistGlobal(systemPatch);
      this.pushSettings();
    }

    if (Object.keys(userPatch).length > 0) {
      await Promise.all(
        Object.entries(userPatch).map(([key, value]) =>
          this.prisma.userSetting.upsert({
            where: { userId_key: { userId, key } },
            update: { value: String(value) },
            create: { userId, key, value: String(value) },
          }),
        ),
      );
    }

    return this.getForUser(userId);
  }

  /** Legacy global update — kept for internal callers; persists everything globally. */
  async update(patch: Partial<Omit<SystemSettings, 'port'>>): Promise<SystemSettings> {
    this.current = { ...this.current, ...patch };
    await this.persistGlobal(patch as Record<string, unknown>);
    this.pushSettings();
    return this.get();
  }

  private async persistGlobal(patch: Record<string, unknown>): Promise<void> {
    const entries = Object.entries(patch)
      .filter(([k]) => k !== 'port')
      .map(([key, value]) => ({
        where: { key },
        update: { value: String(value) },
        create: { key, value: String(value) },
      }));
    await Promise.all(entries.map((args) => this.prisma.setting.upsert(args)));
  }

  /** Whether a key is a per-user setting (vs system-wide). */
  static isUserKey(key: string): boolean {
    return key !== 'port' && !SYSTEM_KEYS.has(key as SettingKey);
  }
}
