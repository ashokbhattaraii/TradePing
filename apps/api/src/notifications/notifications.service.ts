import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type { StockAlert } from '@tradeping/types';
import { SettingsService } from '../settings/settings.service';

export interface NotifyResult {
  ok: boolean;
  error?: string;
}

@Injectable()
export class NotificationsService {
  private cooldowns = new Map<string, number>();

  constructor(
    @Inject(forwardRef(() => SettingsService))
    private readonly settings: SettingsService,
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
    const { slackEnabled, whatsappEnabled, slackMessageTemplate, whatsappMessageTemplate, notificationCooldownMinutes } = this.settings.get();

    if (notificationCooldownMinutes > 0) {
      const now = Date.now();
      const last = this.cooldowns.get(alert.id) || 0;
      if (now - last < notificationCooldownMinutes * 60_000) {
        return; // Cooldown active
      }
      this.cooldowns.set(alert.id, now);
    }

    const slackText = slackMessageTemplate ? this.applyTemplate(slackMessageTemplate, alert, price) : `🔔 *TradePing Alert Triggered*\nSymbol: *${alert.symbol}*\nCondition: ${alert.condition} Rs. ${alert.targetPrice}\nCurrent Price: Rs. ${price}${alert.note ? `\nNote: ${alert.note}` : ''}`;
    const whatsappText = whatsappMessageTemplate ? this.applyTemplate(whatsappMessageTemplate, alert, price) : slackText;

    await Promise.allSettled([
      slackEnabled ? this.sendSlack(slackText) : Promise.resolve(),
      whatsappEnabled ? this.sendWhatsApp(whatsappText) : Promise.resolve(),
    ]);
  }

  async notifyAlertCreated(alert: StockAlert): Promise<void> {
    const { slackEnabled, whatsappEnabled } = this.settings.get();
    const cond = alert.condition.charAt(0) + alert.condition.slice(1).toLowerCase();
    const message = `✅ *New Alert Created*\nTarget: ${alert.symbol} ${cond} Rs. ${alert.targetPrice}`;

    await Promise.allSettled([
      slackEnabled ? this.sendSlack(message) : Promise.resolve(),
      whatsappEnabled ? this.sendWhatsApp(message) : Promise.resolve(),
    ]);
  }

  async notifyAlertExpired(alert: StockAlert): Promise<void> {
    const { slackEnabled, whatsappEnabled } = this.settings.get();
    const message = `⏰ *Alert Expired*\n${alert.symbol} target Rs. ${alert.targetPrice} was not met in time.`;

    await Promise.allSettled([
      slackEnabled ? this.sendSlack(message) : Promise.resolve(),
      whatsappEnabled ? this.sendWhatsApp(message) : Promise.resolve(),
    ]);
  }

  async testSlack(): Promise<NotifyResult> {
    return this.sendSlack('✅ TradePing — Slack is configured correctly. You will receive alerts here.');
  }

  async testWhatsApp(): Promise<NotifyResult> {
    return this.sendWhatsApp('✅ TradePing — WhatsApp is configured correctly. You will receive alerts here.');
  }

  private async sendSlack(message: string): Promise<NotifyResult> {
    const { slackWebhookUrl } = this.settings.get();
    if (!slackWebhookUrl?.trim()) {
      return { ok: false, error: 'Slack webhook URL is not configured.' };
    }
    try {
      const res = await fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
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

  private async sendWhatsApp(message: string): Promise<NotifyResult> {
    const { whatsappAccountSid, whatsappAuthToken, whatsappFromNumber, whatsappPhone } =
      this.settings.get();

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
