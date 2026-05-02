'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  FileText,
  Layers,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  api,
  type NotificationChannelSummary,
  type NotificationRuleSummary,
  type NotificationTemplateSummary,
  type SystemSettings,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Select } from './ui/input';
import { useToast } from './ui/toast';

const EVENTS = ['alert.triggered', 'alert.created', 'alert.expired', 'system.test'] as const;
const RULE_EVENTS = ['alert.triggered', 'alert.created', 'alert.expired'] as const;

const EVENT_LABELS: Record<string, string> = {
  'alert.triggered': 'Alert Triggered',
  'alert.created': 'Alert Created',
  'alert.expired': 'Alert Expired',
  'system.test': 'System Test',
};

const FALLBACK_BODIES: Record<string, string> = {
  'alert.triggered':
    'Alert: *{{alert.symbol}}* {{alert.condition}} Rs.{{alert.targetPrice}}. Current Rs.{{price}}{{#alert.note}} ({{alert.note}}){{/alert.note}}',
  'alert.created': 'New alert: {{alert.symbol}} {{alert.condition}} Rs.{{alert.targetPrice}}',
  'alert.expired': 'Expired: {{alert.symbol}} target Rs.{{alert.targetPrice}} was not met.',
  'system.test': 'TradePing test message. Channel is configured correctly.',
};

const RULE_PRESETS = [
  { id: 'all', label: 'All alerts', priority: 10, filters: {} },
  { id: 'high', label: 'High priority', priority: 30, filters: { priorities: ['HIGH'] } },
  { id: 'above', label: 'Above target', priority: 20, filters: { conditions: ['ABOVE'] } },
  { id: 'below', label: 'Below target', priority: 20, filters: { conditions: ['BELOW'] } },
] as const;

const COOLDOWNS = [0, 5, 15, 30, 60, 180];

type TemplateDraft = {
  event: string;
  channelId: string;
  presetId: string;
};

type RuleDraft = {
  event: string;
  channelId: string;
  templateId: string;
  presetId: string;
  cooldownMin: string;
};

export function NotificationDefaults() {
  const { push } = useToast();
  const [rules, setRules] = useState<NotificationRuleSummary[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateSummary[]>([]);
  const [defaultBodies, setDefaultBodies] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<NotificationChannelSummary[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingRule, setSavingRule] = useState(false);
  const [syncingChannel, setSyncingChannel] = useState<'slack' | 'whatsapp' | null>(null);
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [openTpl, setOpenTpl] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({
    event: 'alert.triggered',
    channelId: 'global',
    presetId: 'builtin',
  });
  const [ruleDraft, setRuleDraft] = useState<RuleDraft>({
    event: 'alert.triggered',
    channelId: '',
    templateId: '',
    presetId: 'all',
    cooldownMin: '15',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t, d, c, s] = await Promise.all([
        api.listNotificationRules().catch(() => ({ data: [] as NotificationRuleSummary[] })),
        api.listNotificationTemplates().catch(() => ({ data: [] as NotificationTemplateSummary[] })),
        api.getDefaultNotificationTemplates().catch(() => ({ data: {} as Record<string, string> })),
        api.listNotificationChannels().catch(() => ({ data: [] as NotificationChannelSummary[] })),
        api.getSettings().catch(() => ({ data: null as SystemSettings | null })),
      ]);
      setRules(r.data);
      setTemplates(t.data);
      setDefaultBodies(d.data);
      setChannels(c.data);
      setSettings(s.data);
      setRuleDraft((prev) => ({
        ...prev,
        channelId: prev.channelId || c.data[0]?.id || '',
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const templatePresets = useMemo(
    () => buildTemplatePresets(templateDraft.event, defaultBodies[templateDraft.event]),
    [defaultBodies, templateDraft.event],
  );
  const selectedTemplatePreset = templatePresets.find((p) => p.id === templateDraft.presetId) ?? templatePresets[0];
  const selectedTemplateBody = selectedTemplatePreset?.body ?? '';
  const selectedTemplateChannelId = templateDraft.channelId === 'global' ? null : templateDraft.channelId;
  const existingDefaultTemplate = templates.find(
    (t) =>
      t.isDefault &&
      t.event === templateDraft.event &&
      (t.channelId ?? 'global') === (selectedTemplateChannelId ?? 'global'),
  );

  const ruleTemplates = useMemo(
    () =>
      templates.filter(
        (t) => t.event === ruleDraft.event && (!t.channelId || t.channelId === ruleDraft.channelId),
      ),
    [ruleDraft.channelId, ruleDraft.event, templates],
  );

  useEffect(() => {
    if (ruleDraft.templateId && !ruleTemplates.some((t) => t.id === ruleDraft.templateId)) {
      setRuleDraft((prev) => ({ ...prev, templateId: '' }));
    }
  }, [ruleDraft.templateId, ruleTemplates]);

  useEffect(() => {
    const presets = buildTemplatePresets(templateDraft.event, defaultBodies[templateDraft.event]);
    if (!presets.some((p) => p.id === templateDraft.presetId)) {
      setTemplateDraft((prev) => ({ ...prev, presetId: presets[0]?.id ?? 'builtin' }));
    }
  }, [defaultBodies, templateDraft.event, templateDraft.presetId]);

  const channelName = (id: string | null | undefined) => {
    if (!id) return 'Any channel';
    return channels.find((c) => c.id === id)?.name ?? id;
  };

  const templateName = (id: string | null | undefined) => {
    if (!id) return 'Default for event';
    return templates.find((t) => t.id === id)?.name ?? id;
  };

  const templateBodyForRule = (rule: NotificationRuleSummary) => {
    const explicit = rule.templateId ? templates.find((t) => t.id === rule.templateId)?.body : null;
    if (explicit) return explicit;
    const channelDefault = templates.find(
      (t) => t.isDefault && t.event === rule.event && t.channelId === rule.channelId,
    )?.body;
    const globalDefault = templates.find((t) => t.isDefault && t.event === rule.event && !t.channelId)?.body;
    return channelDefault ?? globalDefault ?? defaultBodies[rule.event] ?? FALLBACK_BODIES[rule.event] ?? '';
  };

  const hasSlackSettings = Boolean(settings?.slackWebhookUrl?.trim());
  const hasWhatsAppSettings = Boolean(
    settings?.whatsappAccountSid?.trim() &&
      settings?.whatsappAuthToken?.trim() &&
      settings?.whatsappFromNumber?.trim() &&
      settings?.whatsappPhone?.trim(),
  );

  const syncSettingsChannel = async (type: 'slack' | 'whatsapp') => {
    if (type === 'slack' && !hasSlackSettings) {
      push('error', 'Slack webhook URL is empty');
      return;
    }
    if (type === 'whatsapp' && !hasWhatsAppSettings) {
      push('error', 'WhatsApp settings are incomplete');
      return;
    }

    const existing = channels.find((channel) => channel.type === type && channel.name.startsWith('Default '));
    const payload =
      type === 'slack'
        ? {
            name: 'Default Slack',
            type: 'slack',
            enabled: true,
            config: { webhookUrl: settings?.slackWebhookUrl ?? '' },
          }
        : {
            name: 'Default WhatsApp',
            type: 'whatsapp',
            enabled: true,
            config: {
              accountSid: settings?.whatsappAccountSid ?? '',
              authToken: settings?.whatsappAuthToken ?? '',
              fromNumber: settings?.whatsappFromNumber ?? '',
              toNumber: settings?.whatsappPhone ?? '',
            },
          };

    setSyncingChannel(type);
    try {
      if (existing) {
        await api.updateNotificationChannel(existing.id, payload);
      } else {
        await api.createNotificationChannel(payload);
      }
      push('success', `${type === 'slack' ? 'Slack' : 'WhatsApp'} channel linked`);
      await load();
    } catch (err) {
      push('error', (err as Error).message || 'Channel link failed');
    } finally {
      setSyncingChannel(null);
    }
  };

  const saveTemplate = async () => {
    if (!selectedTemplateBody) return;
    setSavingTemplate(true);
    try {
      const channel = selectedTemplateChannelId ? channelName(selectedTemplateChannelId) : 'global';
      const payload = {
        name: `${EVENT_LABELS[templateDraft.event] ?? templateDraft.event} default - ${channel}`,
        event: templateDraft.event,
        channelId: selectedTemplateChannelId,
        body: selectedTemplateBody,
        isDefault: true,
      };
      if (existingDefaultTemplate) {
        await api.updateNotificationTemplate(existingDefaultTemplate.id, payload);
      } else {
        await api.createNotificationTemplate(payload);
      }
      push('success', 'Default template saved');
      await load();
    } catch (err) {
      push('error', (err as Error).message || 'Template save failed');
    } finally {
      setSavingTemplate(false);
    }
  };

  const saveRule = async () => {
    if (!ruleDraft.channelId) {
      push('error', 'Create a notification channel first');
      return;
    }
    const preset = RULE_PRESETS.find((p) => p.id === ruleDraft.presetId) ?? RULE_PRESETS[0];
    const channel = channelName(ruleDraft.channelId);
    setSavingRule(true);
    try {
      await api.createNotificationRule({
        name: `${EVENT_LABELS[ruleDraft.event] ?? ruleDraft.event} -> ${channel}`,
        event: ruleDraft.event,
        enabled: true,
        priority: preset.priority,
        filters: preset.filters,
        channelId: ruleDraft.channelId,
        templateId: ruleDraft.templateId || null,
        cooldownMin: Number(ruleDraft.cooldownMin),
      });
      push('success', 'Notification rule added');
      await load();
    } catch (err) {
      push('error', (err as Error).message || 'Rule save failed');
    } finally {
      setSavingRule(false);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm('Delete this notification template?')) return;
    try {
      await api.deleteNotificationTemplate(id);
      push('info', 'Template deleted');
      await load();
    } catch (err) {
      push('error', (err as Error).message || 'Delete failed');
    }
  };

  const deleteRule = async (id: string) => {
    if (!window.confirm('Delete this notification rule?')) return;
    try {
      await api.deleteNotificationRule(id);
      push('info', 'Rule deleted');
      await load();
    } catch (err) {
      push('error', (err as Error).message || 'Delete failed');
    }
  };

  const storedTemplates = templates.map((t) => ({
    id: t.id,
    source: t.isDefault ? 'Default' : 'Custom',
    name: t.name,
    event: t.event,
    channelId: t.channelId,
    body: t.body,
    subject: t.subject,
    canDelete: true,
  }));

  const builtInTemplates = EVENTS.map((event) => ({
    id: `builtin-${event}`,
    source: 'Built-in',
    name: EVENT_LABELS[event],
    event,
    channelId: null,
    body: defaultBodies[event] ?? FALLBACK_BODIES[event],
    subject: null,
    canDelete: false,
  }));

  return (
    <div className="grid gap-4">
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10">
              <Bell className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Controlled Notification Defaults</div>
              <div className="text-xs text-white/40">Templates and rules are saved from fixed events, channels, filters, and cooldowns.</div>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>

        {loading ? (
          <LoadingBlock label="Loading notification defaults..." />
        ) : (
          <div className="grid gap-4 p-6 lg:grid-cols-2">
            <section className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.025] p-4">
              <SectionHeading icon={Sparkles} title="Default Template" count={templates.filter((t) => t.isDefault).length} />
              <div className="mt-4 grid gap-3">
                <Control label="Event">
                  <Select
                    value={templateDraft.event}
                    onChange={(e) => setTemplateDraft((prev) => ({ ...prev, event: e.target.value, presetId: 'builtin' }))}
                  >
                    {EVENTS.map((event) => (
                      <option key={event} value={event}>
                        {EVENT_LABELS[event]}
                      </option>
                    ))}
                  </Select>
                </Control>
                <Control label="Channel">
                  <Select
                    value={templateDraft.channelId}
                    onChange={(e) => setTemplateDraft((prev) => ({ ...prev, channelId: e.target.value }))}
                  >
                    <option value="global">Any channel</option>
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name} ({channel.type})
                      </option>
                    ))}
                  </Select>
                </Control>
                <Control label="Message">
                  <Select
                    value={templateDraft.presetId}
                    onChange={(e) => setTemplateDraft((prev) => ({ ...prev, presetId: e.target.value }))}
                  >
                    {templatePresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </Select>
                </Control>
                <TemplatePreview body={selectedTemplateBody} event={templateDraft.event} />
                <div className="flex justify-end">
                  <Button onClick={() => void saveTemplate()} loading={savingTemplate}>
                    <CheckCircle2 className="h-4 w-4" />
                    {existingDefaultTemplate ? 'Update Default' : 'Save Default'}
                  </Button>
                </div>
              </div>
            </section>

            <section className="min-w-0 rounded-lg border border-white/[0.07] bg-white/[0.025] p-4">
              <SectionHeading icon={Layers} title="Delivery Rule" count={rules.length} />
              <div className="mt-4 grid gap-3">
                <div className="rounded-md border border-white/[0.06] bg-black/20 p-3">
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-white/70">
                    <Link2 className="h-3.5 w-3.5 text-white/45" aria-hidden="true" />
                    Linked Channels
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={channels.some((channel) => channel.type === 'slack') ? 'secondary' : 'primary'}
                      onClick={() => void syncSettingsChannel('slack')}
                      loading={syncingChannel === 'slack'}
                      disabled={!hasSlackSettings}
                      className="w-full"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {channels.some((channel) => channel.type === 'slack') ? 'Update Slack' : 'Use Slack Settings'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={channels.some((channel) => channel.type === 'whatsapp') ? 'secondary' : 'primary'}
                      onClick={() => void syncSettingsChannel('whatsapp')}
                      loading={syncingChannel === 'whatsapp'}
                      disabled={!hasWhatsAppSettings}
                      className="w-full"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      {channels.some((channel) => channel.type === 'whatsapp') ? 'Update WhatsApp' : 'Use WhatsApp Settings'}
                    </Button>
                  </div>
                </div>
                <Control label="Event">
                  <Select
                    value={ruleDraft.event}
                    onChange={(e) => setRuleDraft((prev) => ({ ...prev, event: e.target.value, templateId: '' }))}
                  >
                    {RULE_EVENTS.map((event) => (
                      <option key={event} value={event}>
                        {EVENT_LABELS[event]}
                      </option>
                    ))}
                  </Select>
                </Control>
                <Control label="Channel">
                  <Select
                    value={ruleDraft.channelId}
                    onChange={(e) => setRuleDraft((prev) => ({ ...prev, channelId: e.target.value, templateId: '' }))}
                    disabled={channels.length === 0}
                  >
                    {channels.length === 0 ? (
                      <option value="">No channels saved</option>
                    ) : (
                      channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name} ({channel.type})
                        </option>
                      ))
                    )}
                  </Select>
                </Control>
                <Control label="Template">
                  <Select
                    value={ruleDraft.templateId}
                    onChange={(e) => setRuleDraft((prev) => ({ ...prev, templateId: e.target.value }))}
                  >
                    <option value="">Default for event</option>
                    {ruleTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </Select>
                </Control>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Control label="Filter">
                    <Select
                      value={ruleDraft.presetId}
                      onChange={(e) => setRuleDraft((prev) => ({ ...prev, presetId: e.target.value }))}
                    >
                      {RULE_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                    </Select>
                  </Control>
                  <Control label="Cooldown">
                    <Select
                      value={ruleDraft.cooldownMin}
                      onChange={(e) => setRuleDraft((prev) => ({ ...prev, cooldownMin: e.target.value }))}
                    >
                      {COOLDOWNS.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes === 0 ? 'None' : `${minutes} min`}
                        </option>
                      ))}
                    </Select>
                  </Control>
                </div>
                <TemplatePreview
                  body={
                    ruleDraft.templateId
                      ? templates.find((t) => t.id === ruleDraft.templateId)?.body ?? ''
                      : defaultBodies[ruleDraft.event] ?? FALLBACK_BODIES[ruleDraft.event] ?? ''
                  }
                  event={ruleDraft.event}
                />
                <div className="flex justify-end">
                  <Button onClick={() => void saveRule()} loading={savingRule} disabled={channels.length === 0}>
                    <CheckCircle2 className="h-4 w-4" />
                    Add Rule
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <ListHeader icon={Layers} title="Notification Rules" count={rules.length} />
        {loading ? (
          <LoadingBlock label="Loading rules..." />
        ) : rules.length === 0 ? (
          <EmptyBlock label="No notification rules saved." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {rules.map((rule) => {
              const open = openRule === rule.id;
              return (
                <li key={rule.id}>
                  <div className="flex items-center gap-2 px-6 py-3 transition-colors hover:bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => setOpenRule(open ? null : rule.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{rule.name}</span>
                          <StatusPill enabled={rule.enabled} />
                        </div>
                        <div className="mt-0.5 truncate text-xs text-white/45">
                          {EVENT_LABELS[rule.event] ?? rule.event}
                          {' -> '}
                          {channelName(rule.channelId)}
                          {rule.cooldownMin > 0 && ` - ${rule.cooldownMin}m cooldown`}
                        </div>
                      </div>
                    </button>
                    <IconButton label="Delete rule" tone="danger" onClick={() => void deleteRule(rule.id)}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </div>
                  {open && (
                    <div className="grid gap-4 border-t border-white/[0.04] bg-black/20 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Event" value={rule.event} mono />
                        <Field label="Channel" value={channelName(rule.channelId)} />
                        <Field label="Template" value={templateName(rule.templateId)} />
                        <Field label="Priority" value={String(rule.priority)} mono />
                        <Field label="Cooldown" value={`${rule.cooldownMin}m`} mono />
                        <Field label="Filter" value={summarizeFilters(rule.filters)} />
                      </div>
                      <TemplatePreview body={templateBodyForRule(rule)} event={rule.event} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <ListHeader icon={FileText} title="Template Library" count={builtInTemplates.length + storedTemplates.length} />
        {loading ? (
          <LoadingBlock label="Loading templates..." />
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {[...builtInTemplates, ...storedTemplates].map((template) => {
              const open = openTpl === template.id;
              return (
                <li key={template.id}>
                  <div className="flex items-center gap-2 px-6 py-3 transition-colors hover:bg-white/[0.02]">
                    <button
                      type="button"
                      onClick={() => setOpenTpl(open ? null : template.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35"
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">{template.name}</span>
                          <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-white/50">
                            {template.source}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-white/45">
                          {EVENT_LABELS[template.event] ?? template.event} - {channelName(template.channelId)}
                        </div>
                      </div>
                    </button>
                    {template.canDelete && (
                      <IconButton label="Delete template" tone="danger" onClick={() => void deleteTemplate(template.id)}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    )}
                  </div>
                  {open && (
                    <div className="grid gap-4 border-t border-white/[0.04] bg-black/20 px-6 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                      <div className="grid gap-3">
                        {template.subject && <Field label="Subject" value={template.subject} mono />}
                        <div>
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Body</div>
                          <pre className="whitespace-pre-wrap break-words rounded-md border border-white/[0.05] bg-black/40 p-3 font-mono text-xs text-white/80">
                            {template.body}
                          </pre>
                        </div>
                      </div>
                      <TemplatePreview body={template.body} event={template.event} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function buildTemplatePresets(event: string, builtIn?: string) {
  const body = builtIn || FALLBACK_BODIES[event] || FALLBACK_BODIES['alert.triggered'];
  const presets = [{ id: 'builtin', label: 'Built-in default', body }];
  if (event === 'alert.triggered') {
    presets.push(
      {
        id: 'brief',
        label: 'Brief alert',
        body: '{{alert.symbol}} {{alert.condition}} Rs.{{alert.targetPrice}}. Current Rs.{{price}}',
      },
      {
        id: 'detailed',
        label: 'Detailed alert',
        body:
          'Alert triggered\nSymbol: {{alert.symbol}}\nCondition: {{alert.condition}}\nTarget: Rs.{{alert.targetPrice}}\nCurrent: Rs.{{price}}\nPriority: {{alert.priority}}{{#alert.note}}\nNote: {{alert.note}}{{/alert.note}}',
      },
    );
  }
  if (event === 'alert.created') {
    presets.push({
      id: 'detailed',
      label: 'Detailed created',
      body:
        'New alert created\nSymbol: {{alert.symbol}}\nCondition: {{alert.condition}}\nTarget: Rs.{{alert.targetPrice}}\nPriority: {{alert.priority}}{{#alert.note}}\nNote: {{alert.note}}{{/alert.note}}',
    });
  }
  if (event === 'alert.expired') {
    presets.push({
      id: 'detailed',
      label: 'Detailed expired',
      body:
        'Alert expired\nSymbol: {{alert.symbol}}\nTarget: Rs.{{alert.targetPrice}}\nCondition: {{alert.condition}}\nCreated: {{alert.createdAt}}',
    });
  }
  return presets;
}

function SectionHeading({
  icon: Icon,
  title,
  count,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.05]">
        <Icon className="h-4 w-4 text-white/65" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 text-sm font-semibold text-white">{title}</div>
      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
        {count}
      </span>
    </div>
  );
}

function ListHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: React.ElementType;
  title: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05]">
        <Icon className="h-4 w-4 text-white/65" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1 text-sm font-semibold text-white">{title}</div>
      <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
        {count}
      </span>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</span>
      {children}
    </label>
  );
}

function TemplatePreview({ body, event, compact }: { body: string; event: string; compact?: boolean }) {
  const [rendered, setRendered] = useState('');
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    if (!body) {
      setRendered('');
      setState('ok');
      return;
    }
    setState('loading');
    api
      .previewNotificationTemplate({ body, event })
      .then((res) => {
        if (!active) return;
        setRendered(res.data.rendered);
        setState('ok');
      })
      .catch((err: Error) => {
        if (!active) return;
        setRendered(err.message || 'Preview unavailable');
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [body, event]);

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
        <Eye className="h-3 w-3" aria-hidden="true" />
        Preview
      </div>
      <pre
        className={cn(
          'min-h-24 whitespace-pre-wrap break-words rounded-md border p-3 text-sm text-white/80',
          compact ? 'bg-black/40' : 'bg-black/30',
          state === 'error' ? 'border-red-400/20 text-red-300' : 'border-white/[0.06]',
        )}
      >
        {state === 'loading' ? 'Rendering preview...' : rendered}
      </pre>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm text-white/75', mono && 'font-mono text-xs')}>{value}</div>
    </div>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        enabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.05] text-white/40',
      )}
    >
      {enabled ? 'enabled' : 'disabled'}
    </span>
  );
}

function IconButton({
  label,
  tone,
  children,
  onClick,
}: {
  label: string;
  tone?: 'danger';
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35',
        tone === 'danger'
          ? 'border-red-400/15 bg-red-400/5 text-red-300/70 hover:border-red-400/30 hover:text-red-200'
          : 'border-white/10 bg-white/[0.03] text-white/50 hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center px-6 py-10 text-xs text-white/40">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyBlock({ label }: { label: string }) {
  return <div className="px-6 py-10 text-center text-xs text-white/40">{label}</div>;
}

function summarizeFilters(filters: Record<string, unknown>) {
  const parts: string[] = [];
  if (Array.isArray(filters.priorities) && filters.priorities.length > 0) {
    parts.push(`priority ${filters.priorities.join(', ')}`);
  }
  if (Array.isArray(filters.conditions) && filters.conditions.length > 0) {
    parts.push(`condition ${filters.conditions.join(', ')}`);
  }
  if (Array.isArray(filters.symbols) && filters.symbols.length > 0) {
    parts.push(`symbols ${filters.symbols.join(', ')}`);
  }
  if (typeof filters.minTargetPrice === 'number') parts.push(`min Rs.${filters.minTargetPrice}`);
  if (typeof filters.maxTargetPrice === 'number') parts.push(`max Rs.${filters.maxTargetPrice}`);
  return parts.join(' - ') || 'All alerts';
}
