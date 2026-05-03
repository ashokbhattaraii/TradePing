import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { NotificationEvent, NotificationRuleFilters, StockAlert } from '@tradeping/types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { SystemSettings } from '../settings/settings.service';
import { ChannelsService } from './channels.service';
import { dispatch } from './dispatchers';
import { TemplatesService } from './templates.service';
import type { TemplateContext } from './template-engine';

export interface NotifyResult {
  ok: boolean;
  error?: string;
}

interface SlackMessage {
  text: string;
  blocks?: Array<Record<string, unknown>>;
}

type NotificationTestOverrides = Partial<
  Pick<SystemSettings, 'slackWebhookUrl' | 'whatsappAccountSid' | 'whatsappAuthToken' | 'whatsappFromNumber' | 'whatsappPhone'>
>;

@Injectable()
export class NotificationsService {
  private cooldowns = new Map<string, number>();
  private ruleCooldowns = new Map<string, number>();

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly channels: ChannelsService,
    private readonly templates: TemplatesService,
  ) {}

  private applyTemplate(template: string, alert: StockAlert, price: number): string {
    const body = alert.note
      ? template.replace(/\{\{#note\}\}/g, '').replace(/\{\{\/note\}\}/g, '').replace(/\{\{note\}\}/g, alert.note)
      : template.replace(/\{\{#note\}\}.*?\{\{\/note\}\}/g, '');

    return body
      .replace(/\{\{symbol\}\}/g, alert.symbol)
      .replace(/\{\{condition\}\}/g, alert.condition)
      .replace(/\{\{target\}\}/g, alert.targetPrice.toString())
      .replace(/\{\{price\}\}/g, price.toString());
  }

  /** Called by CrawlerService when an alert target price is hit. */
  async notifyAlertTriggered(alert: StockAlert, price: number): Promise<void> {
    await this.notifyByRules('alert.triggered', alert, price);

    const settings = await this.effectiveSettings(alert.userId);
    const { whatsappEnabled, whatsappMessageTemplate, notificationCooldownMinutes } = settings;

    if (notificationCooldownMinutes > 0) {
      const now = Date.now();
      const last = this.cooldowns.get(alert.id) || 0;
      if (now - last < notificationCooldownMinutes * 60_000) {
        return; // Cooldown active
      }
      this.cooldowns.set(alert.id, now);
    }

    const slackMessage = this.slackAlertMessage('triggered', alert, price);
    const whatsappText = whatsappMessageTemplate
      ? this.applyTemplate(whatsappMessageTemplate, alert, price)
      : this.plainAlertMessage('triggered', alert, price);

    await Promise.allSettled([
      this.shouldSendSlack(settings) ? this.sendSlack(slackMessage, settings.slackWebhookUrl) : Promise.resolve(),
      whatsappEnabled ? this.sendWhatsApp(whatsappText) : Promise.resolve(),
    ]);
  }

  async notifyAlertCreated(alert: StockAlert): Promise<void> {
    await this.notifyByRules('alert.created', alert);

    const settings = await this.effectiveSettings(alert.userId);
    const message = this.plainAlertMessage('created', alert);

    await Promise.allSettled([
      this.shouldSendSlack(settings) ? this.sendSlack(this.slackAlertMessage('created', alert), settings.slackWebhookUrl) : Promise.resolve(),
      settings.whatsappEnabled ? this.sendWhatsApp(message) : Promise.resolve(),
    ]);
  }

  async notifyAlertExpired(alert: StockAlert): Promise<void> {
    await this.notifyByRules('alert.expired', alert);

    const settings = await this.effectiveSettings(alert.userId);
    const message = this.plainAlertMessage('expired', alert);

    await Promise.allSettled([
      this.shouldSendSlack(settings) ? this.sendSlack(this.slackAlertMessage('expired', alert), settings.slackWebhookUrl) : Promise.resolve(),
      settings.whatsappEnabled ? this.sendWhatsApp(message) : Promise.resolve(),
    ]);
  }

  async notifyAlertClosed(alert: StockAlert): Promise<void> {
    const settings = await this.effectiveSettings(alert.userId);
    const message = this.plainAlertMessage('closed', alert);

    await Promise.allSettled([
      this.shouldSendSlack(settings) ? this.sendSlack(this.slackAlertMessage('closed', alert), settings.slackWebhookUrl) : Promise.resolve(),
      settings.whatsappEnabled ? this.sendWhatsApp(message) : Promise.resolve(),
    ]);
  }

  async testSlack(userId?: string, overrides: NotificationTestOverrides = {}): Promise<NotifyResult> {
    const effective = userId ? await this.settings.getForUser(userId) : this.settings.get();
    return this.sendSlack(this.slackSystemMessage('Slack test message', 'TradePing is configured correctly. You will receive alerts here.'), overrides.slackWebhookUrl ?? effective.slackWebhookUrl);
  }

  async testWhatsApp(userId?: string, overrides: NotificationTestOverrides = {}): Promise<NotifyResult> {
    const effective = userId ? await this.settings.getForUser(userId) : this.settings.get();
    return this.sendWhatsApp('✅ TradePing — WhatsApp is configured correctly. You will receive alerts here.', {
      whatsappAccountSid: overrides.whatsappAccountSid ?? effective.whatsappAccountSid,
      whatsappAuthToken: overrides.whatsappAuthToken ?? effective.whatsappAuthToken,
      whatsappFromNumber: overrides.whatsappFromNumber ?? effective.whatsappFromNumber,
      whatsappPhone: overrides.whatsappPhone ?? effective.whatsappPhone,
    });
  }

  async hasEnabledRulesForEvent(event: NotificationEvent, userId?: string | null): Promise<boolean> {
    if (!userId) return false;
    const count = await this.prisma.notificationRule.count({ where: { event, enabled: true, userId } });
    return count > 0;
  }

  private async effectiveSettings(userId?: string | null): Promise<SystemSettings> {
    return userId ? this.settings.getForUser(userId).catch(() => this.settings.get()) : this.settings.get();
  }

  private shouldSendSlack(settings: SystemSettings): boolean {
    return Boolean(settings.slackWebhookUrl?.trim());
  }

  private titleCase(value: string): string {
    return value.charAt(0) + value.slice(1).toLowerCase();
  }

  private formatMoney(value: number | null | undefined): string {
    return typeof value === 'number' ? `Rs. ${value.toLocaleString('en-NP', { maximumFractionDigits: 2 })}` : 'Not available';
  }

  private plainAlertMessage(kind: 'created' | 'triggered' | 'expired' | 'closed', alert: StockAlert, price?: number): string {
    const labels = {
      created: 'New alert created',
      triggered: 'Alert triggered',
      expired: 'Alert expired',
      closed: 'Alert closed',
    };
    return [
      `${labels[kind]}: ${alert.symbol}`,
      `Condition: ${this.titleCase(alert.condition)} ${this.formatMoney(alert.targetPrice)}`,
      price !== undefined ? `Current: ${this.formatMoney(price)}` : null,
      `Priority: ${this.titleCase(alert.priority)}`,
      alert.note ? `Note: ${alert.note}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private slackSystemMessage(title: string, detail: string): SlackMessage {
    return {
      text: `TradePing: ${title}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: detail } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `TradePing • ${new Date().toLocaleString('en-NP')}` }] },
      ],
    };
  }

  private slackAlertMessage(kind: 'created' | 'triggered' | 'expired' | 'closed', alert: StockAlert, price?: number): SlackMessage {
    const meta = {
      created: { title: 'Alert Created', marker: '✅', tone: 'New alert is now active' },
      triggered: { title: 'Alert Triggered', marker: '🚨', tone: 'Target condition has been met' },
      expired: { title: 'Alert Expired', marker: '⏰', tone: 'Target was not met before expiry' },
      closed: { title: 'Alert Closed', marker: '🗑️', tone: 'Alert was removed from the queue' },
    }[kind];
    const fields = [
      { type: 'mrkdwn', text: `*Symbol*\n${alert.symbol}` },
      { type: 'mrkdwn', text: `*Condition*\n${this.titleCase(alert.condition)} ${this.formatMoney(alert.targetPrice)}` },
      { type: 'mrkdwn', text: `*Priority*\n${this.titleCase(alert.priority)}` },
      { type: 'mrkdwn', text: `*Status*\n${this.titleCase(kind === 'closed' ? 'CLOSED' : alert.status)}` },
    ];
    if (price !== undefined) {
      fields.splice(2, 0, { type: 'mrkdwn', text: `*Current Price*\n${this.formatMoney(price)}` });
    }

    return {
      text: `TradePing ${meta.title}: ${alert.symbol}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `${meta.marker} ${meta.title}`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `*${meta.tone}*` } },
        { type: 'section', fields },
        ...(alert.note ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Note*\n${alert.note}` } }] : []),
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `TradePing • ${new Date().toLocaleString('en-NP')} • Alert ID ${alert.id.slice(0, 8)}`,
            },
          ],
        },
      ],
    };
  }

  private async notifyByRules(event: NotificationEvent, alert?: StockAlert, price?: number): Promise<boolean> {
    const userId = alert?.userId;
    if (!userId) return false;
    const rules = await this.prisma.notificationRule.findMany({
      where: { event, enabled: true, userId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    if (rules.length === 0) return false;

    const ctx = this.templateContext(event, alert, price);
    await Promise.allSettled(
      rules.map(async (rule) => {
        if (!this.matchesFilters(rule.filters, alert)) return;
        if (this.isRuleCoolingDown(rule.id, alert?.id ?? event, rule.cooldownMin)) return;

        const channel = await this.channels.findOneRaw(rule.channelId, userId);
        if (!channel?.enabled) return;

        const payload = await this.templates.resolveBody({
          templateId: rule.templateId,
          event,
          channelId: rule.channelId,
          userId,
          ctx,
        });
        await dispatch(channel.type, channel.config, payload);
      }),
    );
    return true;
  }

  private templateContext(event: NotificationEvent, alert?: StockAlert, price?: number): TemplateContext {
    const targetPrice = alert?.targetPrice;
    return {
      alert,
      price: price ?? alert?.lastCheckedPrice ?? undefined,
      symbol: alert?.symbol,
      condition: alert?.condition,
      target: targetPrice,
      note: alert?.note,
      event,
      timestamp: new Date().toISOString(),
    };
  }

  private matchesFilters(filters: unknown, alert?: StockAlert): boolean {
    if (!alert) return true;
    const f = (filters ?? {}) as NotificationRuleFilters;
    if (Array.isArray(f.priorities) && f.priorities.length > 0 && !f.priorities.includes(alert.priority)) {
      return false;
    }
    if (Array.isArray(f.symbols) && f.symbols.length > 0 && !f.symbols.includes(alert.symbol.toUpperCase())) {
      return false;
    }
    if (Array.isArray(f.conditions) && f.conditions.length > 0 && !f.conditions.includes(alert.condition)) {
      return false;
    }
    if (typeof f.minTargetPrice === 'number' && alert.targetPrice < f.minTargetPrice) return false;
    if (typeof f.maxTargetPrice === 'number' && alert.targetPrice > f.maxTargetPrice) return false;
    return true;
  }

  private isRuleCoolingDown(ruleId: string, subjectId: string, cooldownMin: number): boolean {
    if (cooldownMin <= 0) return false;
    const key = `${ruleId}:${subjectId}`;
    const now = Date.now();
    const last = this.ruleCooldowns.get(key) || 0;
    if (now - last < cooldownMin * 60_000) return true;
    this.ruleCooldowns.set(key, now);
    return false;
  }

  private async sendSlack(message: string | SlackMessage, webhookOverride?: string): Promise<NotifyResult> {
    const { slackWebhookUrl: configuredWebhookUrl } = this.settings.get();
    const slackWebhookUrl = webhookOverride ?? configuredWebhookUrl;
    if (!slackWebhookUrl?.trim()) {
      return { ok: false, error: 'Slack webhook URL is not configured.' };
    }
    try {
      const res = await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof message === 'string' ? { text: message } : message),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Slack API responded with ${res.status}: ${body}`);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private async sendWhatsApp(
    message: string,
    overrides: Partial<
      Pick<SystemSettings, 'whatsappAccountSid' | 'whatsappAuthToken' | 'whatsappFromNumber' | 'whatsappPhone'>
    > = {},
  ): Promise<NotifyResult> {
    const configured = this.settings.get();
    const whatsappAccountSid = overrides.whatsappAccountSid ?? configured.whatsappAccountSid;
    const whatsappAuthToken = overrides.whatsappAuthToken ?? configured.whatsappAuthToken;
    const whatsappFromNumber = overrides.whatsappFromNumber ?? configured.whatsappFromNumber;
    const whatsappPhone = overrides.whatsappPhone ?? configured.whatsappPhone;

    if (!whatsappAccountSid?.trim() || !whatsappAuthToken?.trim()) {
      return { ok: false, error: 'Twilio Account SID and Auth Token are required.' };
    }
    if (!whatsappFromNumber?.trim() || !whatsappPhone?.trim()) {
      return { ok: false, error: 'Twilio from/to phone numbers are required.' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${whatsappAccountSid}/Messages.json`;
    const credentials = Buffer.from(`${whatsappAccountSid}:${whatsappAuthToken}`).toString('base64');
    const body = new URLSearchParams({
      From: `whatsapp:${whatsappFromNumber}`,
      To: `whatsapp:${whatsappPhone}`,
      Body: message,
    });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${credentials}`,
        },
        body: body.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Twilio API responded with ${res.status}: ${text}`);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
