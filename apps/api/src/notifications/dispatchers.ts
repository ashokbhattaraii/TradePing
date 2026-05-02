import type { NotificationChannelType } from '@tradeping/types';

export interface DispatchResult {
  ok: boolean;
  error?: string;
}

export interface DispatchPayload {
  body: string;
  subject?: string | null;
}

export type ChannelConfig = Record<string, unknown>;

function s(config: ChannelConfig, key: string): string {
  const v = config[key];
  return typeof v === 'string' ? v.trim() : '';
}

async function sendSlack(config: ChannelConfig, payload: DispatchPayload): Promise<DispatchResult> {
  const webhookUrl = s(config, 'webhookUrl');
  if (!webhookUrl) return { ok: false, error: 'Slack webhook URL is not configured.' };
  const channel = s(config, 'channel');
  const username = s(config, 'username');
  const iconEmoji = s(config, 'iconEmoji');
  const body: Record<string, unknown> = { text: payload.body };
  if (channel) body.channel = channel;
  if (username) body.username = username;
  if (iconEmoji) body.icon_emoji = iconEmoji;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Slack ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendWhatsApp(config: ChannelConfig, payload: DispatchPayload): Promise<DispatchResult> {
  const accountSid = s(config, 'accountSid');
  const authToken = s(config, 'authToken');
  const fromNumber = s(config, 'fromNumber');
  const toNumber = s(config, 'toNumber');
  if (!accountSid || !authToken) return { ok: false, error: 'Twilio Account SID and Auth Token are required.' };
  if (!fromNumber || !toNumber) return { ok: false, error: 'From/To phone numbers are required.' };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const form = new URLSearchParams({
    From: `whatsapp:${fromNumber}`,
    To: `whatsapp:${toNumber}`,
    Body: payload.body,
  });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Twilio ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendDiscord(config: ChannelConfig, payload: DispatchPayload): Promise<DispatchResult> {
  const webhookUrl = s(config, 'webhookUrl');
  if (!webhookUrl) return { ok: false, error: 'Discord webhook URL is not configured.' };
  const username = s(config, 'username');
  const body: Record<string, unknown> = { content: payload.body };
  if (username) body.username = username;
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Discord ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendTelegram(config: ChannelConfig, payload: DispatchPayload): Promise<DispatchResult> {
  const botToken = s(config, 'botToken');
  const chatId = s(config, 'chatId');
  if (!botToken || !chatId) return { ok: false, error: 'Bot token and chat ID are required.' };
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: payload.body, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Telegram ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendWebhook(config: ChannelConfig, payload: DispatchPayload): Promise<DispatchResult> {
  const url = s(config, 'url');
  if (!url) return { ok: false, error: 'Webhook URL is not configured.' };
  const method = s(config, 'method').toUpperCase() || 'POST';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const headersJson = s(config, 'headers');
  if (headersJson) {
    try {
      Object.assign(headers, JSON.parse(headersJson));
    } catch {
      return { ok: false, error: 'Invalid headers JSON.' };
    }
  }
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: JSON.stringify({ subject: payload.subject ?? null, body: payload.body }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Webhook ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function sendEmail(_config: ChannelConfig, _payload: DispatchPayload): Promise<DispatchResult> {
  return { ok: false, error: 'Email dispatcher is not yet implemented.' };
}

const DISPATCHERS: Record<NotificationChannelType, (c: ChannelConfig, p: DispatchPayload) => Promise<DispatchResult>> = {
  slack: sendSlack,
  whatsapp: sendWhatsApp,
  discord: sendDiscord,
  telegram: sendTelegram,
  webhook: sendWebhook,
  email: sendEmail,
};

export async function dispatch(
  type: NotificationChannelType,
  config: ChannelConfig,
  payload: DispatchPayload,
): Promise<DispatchResult> {
  const fn = DISPATCHERS[type];
  if (!fn) return { ok: false, error: `Unknown channel type: ${type}` };
  return fn(config, payload);
}
