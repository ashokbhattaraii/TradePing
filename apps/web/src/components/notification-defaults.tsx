'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Layers, Loader2, Sparkles } from 'lucide-react';
import {
  api,
  type NotificationChannelSummary,
  type NotificationRuleSummary,
  type NotificationTemplateSummary,
} from '@/lib/api';
import { Card } from './ui/card';
import { cn } from '@/lib/utils';

const EVENT_LABELS: Record<string, string> = {
  'alert.triggered': 'Alert Triggered',
  'alert.created': 'Alert Created',
  'alert.expired': 'Alert Expired',
  'system.test': 'System Test',
};

export function NotificationDefaults() {
  const [rules, setRules] = useState<NotificationRuleSummary[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateSummary[]>([]);
  const [defaultBodies, setDefaultBodies] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<NotificationChannelSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRule, setOpenRule] = useState<string | null>(null);
  const [openTpl, setOpenTpl] = useState<string | null>(null);
  const [openDefault, setOpenDefault] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listNotificationRules().catch(() => ({ data: [] as NotificationRuleSummary[] })),
      api.listNotificationTemplates().catch(() => ({ data: [] as NotificationTemplateSummary[] })),
      api.getDefaultNotificationTemplates().catch(() => ({ data: {} as Record<string, string> })),
      api.listNotificationChannels().catch(() => ({ data: [] as NotificationChannelSummary[] })),
    ])
      .then(([r, t, d, c]) => {
        setRules(r.data);
        setTemplates(t.data);
        setDefaultBodies(d.data);
        setChannels(c.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const channelName = (id: string | null | undefined) => {
    if (!id) return 'Any channel';
    return channels.find((c) => c.id === id)?.name ?? id;
  };

  const defaultRules = rules; // all currently configured rules
  const defaultTemplates = templates.filter((t) => t.isDefault);
  const customTemplates = templates.filter((t) => !t.isDefault);

  return (
    <div className="grid gap-4">
      {/* Default rules */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-400/10">
            <Layers className="h-4 w-4 text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Default Notification Rules</div>
            <div className="text-xs text-white/40">
              Read-only view of which events route to which channels. Manage in the Database tab.
            </div>
          </div>
          <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
            {defaultRules.length}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center px-6 py-10 text-xs text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading rules…
          </div>
        ) : defaultRules.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-white/40">
            No notification rules configured. Add one in the Database → Notification Rules table.
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {defaultRules.map((r) => {
              const open = openRule === r.id;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpenRule(open ? null : r.id)}
                    className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white">{r.name}</span>
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                              r.enabled ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[0.05] text-white/40',
                            )}
                          >
                            {r.enabled ? 'enabled' : 'disabled'}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-white/45">
                          {EVENT_LABELS[r.event] ?? r.event} → {channelName(r.channelId)} · priority {r.priority}
                          {r.cooldownMin > 0 && ` · ${r.cooldownMin}m cooldown`}
                        </div>
                      </div>
                    </div>
                  </button>
                  {open && (
                    <div className="grid gap-3 border-t border-white/[0.04] bg-black/20 px-6 py-4 sm:grid-cols-2">
                      <Field label="Event" value={r.event} mono />
                      <Field label="Channel" value={channelName(r.channelId)} />
                      <Field label="Template" value={r.templateId ? channelName(r.templateId) : 'Default for event'} />
                      <Field label="Priority" value={String(r.priority)} mono />
                      <Field label="Cooldown" value={`${r.cooldownMin}m`} mono />
                      <Field label="Filters" value={JSON.stringify(r.filters || {})} mono pre />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Default templates (built-in) */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400/10">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Built-in Default Templates</div>
            <div className="text-xs text-white/40">
              Used as the fallback body when no custom template is bound to the event.
            </div>
          </div>
          <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
            {Object.keys(defaultBodies).length}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center px-6 py-10 text-xs text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading templates…
          </div>
        ) : Object.keys(defaultBodies).length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-white/40">No default templates available.</div>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {Object.entries(defaultBodies).map(([event, body]) => {
              const open = openDefault === event;
              return (
                <li key={event}>
                  <button
                    type="button"
                    onClick={() => setOpenDefault(open ? null : event)}
                    className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-white/[0.02]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white">{EVENT_LABELS[event] ?? event}</div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-white/40">{event}</div>
                      </div>
                    </div>
                  </button>
                  {open && (
                    <div className="border-t border-white/[0.04] bg-black/20 px-6 py-4">
                      <pre className="whitespace-pre-wrap break-words rounded-md border border-white/[0.05] bg-black/40 p-3 font-mono text-xs text-white/80">
                        {body}
                      </pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Default + custom user templates */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-6 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/10">
            <FileText className="h-4 w-4 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">Stored Templates</div>
            <div className="text-xs text-white/40">
              Templates saved in the database. Defaults are picked when no template is explicitly bound.
            </div>
          </div>
          <span className="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55">
            {templates.length}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center px-6 py-10 text-xs text-white/40">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <div className="px-6 py-10 text-center text-xs text-white/40">
            No stored templates. The built-in defaults above will be used.
          </div>
        ) : (
          <div>
            {defaultTemplates.length > 0 && (
              <div className="px-6 py-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400/70">
                Defaults
              </div>
            )}
            <ul className="divide-y divide-white/[0.05]">
              {[...defaultTemplates, ...customTemplates].map((t, idx) => {
                const open = openTpl === t.id;
                const showDivider = idx === defaultTemplates.length && customTemplates.length > 0 && defaultTemplates.length > 0;
                return (
                  <div key={t.id}>
                    {showDivider && (
                      <div className="px-6 py-2 text-[10px] font-semibold uppercase tracking-wider text-white/35">
                        Custom
                      </div>
                    )}
                    <li>
                      <button
                        type="button"
                        onClick={() => setOpenTpl(open ? null : t.id)}
                        className="flex w-full items-center justify-between gap-3 px-6 py-3 text-left transition-colors hover:bg-white/[0.02]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          {open ? <ChevronDown className="h-3.5 w-3.5 text-white/40" /> : <ChevronRight className="h-3.5 w-3.5 text-white/40" />}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-white">{t.name}</span>
                              {t.isDefault && (
                                <span className="rounded-full bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                  default
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-white/45">
                              {EVENT_LABELS[t.event] ?? t.event} · {channelName(t.channelId)}
                            </div>
                          </div>
                        </div>
                      </button>
                      {open && (
                        <div className="grid gap-3 border-t border-white/[0.04] bg-black/20 px-6 py-4">
                          {t.subject && <Field label="Subject" value={t.subject} mono />}
                          <div>
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Body</div>
                            <pre className="whitespace-pre-wrap break-words rounded-md border border-white/[0.05] bg-black/40 p-3 font-mono text-xs text-white/80">
                              {t.body}
                            </pre>
                          </div>
                        </div>
                      )}
                    </li>
                  </div>
                );
              })}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function Field({ label, value, mono, pre }: { label: string; value: string; mono?: boolean; pre?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40">{label}</div>
      {pre ? (
        <pre className={cn('mt-1 whitespace-pre-wrap break-words rounded-md border border-white/[0.05] bg-black/40 p-2 text-xs text-white/75', mono && 'font-mono')}>
          {value}
        </pre>
      ) : (
        <div className={cn('mt-0.5 truncate text-sm text-white/75', mono && 'font-mono text-xs')}>{value}</div>
      )}
    </div>
  );
}
