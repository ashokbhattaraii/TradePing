export type StockSymbol = string;

export type AlertCondition = 'ABOVE' | 'BELOW' | 'EQUAL';
export type AlertStatus = 'ACTIVE' | 'TRIGGERED';
export type AlertPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS';

export interface StockAlert {
  id: string;
  userId?: string | null;
  symbol: StockSymbol;
  targetPrice: number;
  condition: AlertCondition;
  status: AlertStatus;
  priority: AlertPriority;
  note: string | null;
  lastCheckedPrice: number | null;
  createdAt: string;
  triggeredAt: string | null;
}

export interface CrawlerLog {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface CrawlerResult {
  symbol: StockSymbol;
  price: number;
  source: 'LIVE' | 'MOCK';
  timestamp: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export const STOCK_SYMBOLS: StockSymbol[] = [
  'NABIL',
  'NICA',
  'HDL',
  'API',
  'SHIVM',
  'NIFRA',
  'GBIME',
  'SANIMA',
  'NRIC',
  'CIT',
  'PALPA',
];

export const STOCK_ALIASES: Record<string, StockSymbol> = {
  PALPA: 'PCIL',
  PALPACEMENT: 'PCIL',
  PALPACEMENTS: 'PCIL',
};

export const ALERT_CONDITIONS: AlertCondition[] = ['ABOVE', 'BELOW', 'EQUAL'];
export const ALERT_PRIORITIES: AlertPriority[] = ['HIGH', 'MEDIUM', 'LOW'];

// ── Notifications ──────────────────────────────────────────────────────────
export type NotificationChannelType =
  | 'slack'
  | 'whatsapp'
  | 'discord'
  | 'telegram'
  | 'webhook'
  | 'email';

export type NotificationEvent =
  | 'alert.triggered'
  | 'alert.created'
  | 'alert.expired'
  | 'system.test';

export const NOTIFICATION_CHANNEL_TYPES: NotificationChannelType[] = [
  'slack',
  'whatsapp',
  'discord',
  'telegram',
  'webhook',
  'email',
];

export const NOTIFICATION_EVENTS: NotificationEvent[] = [
  'alert.triggered',
  'alert.created',
  'alert.expired',
  'system.test',
];

export interface NotificationChannel {
  id: string;
  name: string;
  type: NotificationChannelType;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  event: NotificationEvent;
  channelId: string | null;
  body: string;
  subject: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRuleFilters {
  /** Match alert priority(s). Empty/missing = match all. */
  priorities?: AlertPriority[];
  /** Match alert symbol(s). Empty/missing = match all. */
  symbols?: string[];
  /** Match condition(s). */
  conditions?: AlertCondition[];
  /** Inclusive minimum target price. */
  minTargetPrice?: number;
  /** Inclusive maximum target price. */
  maxTargetPrice?: number;
}

export interface NotificationRule {
  id: string;
  name: string;
  event: NotificationEvent;
  enabled: boolean;
  priority: number;
  filters: NotificationRuleFilters;
  channelId: string;
  templateId: string | null;
  cooldownMin: number;
  createdAt: string;
  updatedAt: string;
}
