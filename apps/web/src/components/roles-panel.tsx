'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Lock, Plus, RefreshCw, Shield, Trash2, X } from 'lucide-react';
import {
  api,
  type PermissionDef,
  type RoleSummary,
  type RolesResponse,
} from '@/lib/api';
import { useAuth } from './auth-provider';
import { hasPermission, isSuperAdmin } from '@/lib/permissions';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { Badge } from './ui/badge';
import { useToast } from './ui/toast';
import { cn } from '@/lib/utils';

export function RolesPanel() {
  const toast = useToast();
  const { user } = useAuth();
  const canRead = hasPermission(user, 'roles.read');
  const canWrite = hasPermission(user, 'roles.write');
  const isSuper = isSuperAdmin(user);

  const [data, setData] = useState<RolesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!canRead) return;
      if (showSpinner) setRefreshing(true);
      try {
        const res = await api.listAdminRoles();
        setData(res.data);
        if (!activeKey && res.data.roles.length > 0) {
          setActiveKey(res.data.roles[0].key);
        }
      } catch (err) {
        toast.push('error', (err as Error).message || 'Failed to load roles');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canRead, activeKey, toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (!canRead) {
    return (
      <Card className="p-8 text-sm text-white/55">
        <div className="flex items-center gap-2 text-white/70">
          <Shield className="h-4 w-4" /> You don’t have permission to view roles.
        </div>
      </Card>
    );
  }

  if (loading || !data) {
    return (
      <Card className="flex items-center justify-center gap-2 p-12 text-sm text-white/55">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading roles…
      </Card>
    );
  }

  const active = data.roles.find((r) => r.key === activeKey) ?? data.roles[0];

  const handleDelete = async (role: RoleSummary) => {
    if (!isSuper) return;
    if (!window.confirm(`Delete role ${role.name}? This cannot be undone.`)) return;
    try {
      await api.deleteAdminRole(role.key);
      toast.push('success', 'Role deleted');
      setActiveKey(null);
      void load(true);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Failed to delete role');
    }
  };

  return (
    <div className="grid gap-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Roles & permissions</h2>
          <p className="text-xs text-white/45">
            Define what each role can do. {data.roles.length} roles · {data.catalog.length} permissions in catalog.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          {isSuper && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> New role
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[280px,1fr]">
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-white/[0.04]">
            {data.roles.map((r) => {
              const isActive = r.key === active?.key;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(r.key)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors',
                      isActive ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-white">{r.name}</span>
                        {r.isSystem && (
                          <span title="System role">
                            <Lock className="h-3 w-3 text-white/35" />
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] uppercase tracking-wider text-white/35">
                        {r.key}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge>{r.userCount} user{r.userCount === 1 ? '' : 's'}</Badge>
                      <span className="font-mono text-[10px] text-white/35">
                        {r.permissions.includes('*') ? '∞' : r.permissions.length} perms
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {active && (
          <RoleEditor
            key={active.key}
            role={active}
            catalog={data.catalog}
            canWrite={canWrite && isSuper}
            isSuper={isSuper}
            onSaved={(updated) => {
              setData((prev) =>
                prev
                  ? {
                      ...prev,
                      roles: prev.roles.map((r) => (r.key === updated.key ? { ...r, ...updated } : r)),
                    }
                  : prev,
              );
              toast.push('success', 'Role saved');
            }}
            onDelete={() => handleDelete(active)}
          />
        )}
      </div>

      {createOpen && (
        <CreateRoleModal
          catalog={data.catalog}
          onClose={() => setCreateOpen(false)}
          onCreated={(role) => {
            setCreateOpen(false);
            setActiveKey(role.key);
            void load(true);
            toast.push('success', `Role ${role.name} created`);
          }}
        />
      )}
    </div>
  );
}

function RoleEditor({
  role,
  catalog,
  canWrite,
  isSuper,
  onSaved,
  onDelete,
}: {
  role: RoleSummary;
  catalog: PermissionDef[];
  canWrite: boolean;
  isSuper: boolean;
  onSaved: (r: RoleSummary) => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role.permissions));
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) {
      if (!map.has(p.group)) map.set(p.group, []);
      map.get(p.group)!.push(p);
    }
    return map;
  }, [catalog]);

  const wildcard = perms.has('*');
  const dirty =
    name !== role.name ||
    (description ?? '') !== (role.description ?? '') ||
    !setEqual(perms, new Set(role.permissions));

  const toggle = (key: string) => {
    if (!canWrite || wildcard) return;
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: string, on: boolean) => {
    if (!canWrite || wildcard) return;
    setPerms((prev) => {
      const next = new Set(prev);
      const keys = (grouped.get(group) ?? []).map((p) => p.key);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.updateAdminRole(role.key, {
        name,
        description: description || undefined,
        permissions: Array.from(perms),
      });
      onSaved(res.data);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Failed to save role');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="grid gap-5 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs text-white/55">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
        </label>
        <label className="grid gap-1.5">
          <span className="text-xs text-white/55">Key</span>
          <Input value={role.key} disabled className="font-mono" />
        </label>
        <label className="sm:col-span-2 grid gap-1.5">
          <span className="text-xs text-white/55">Description</span>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this role can do…"
            disabled={!canWrite}
          />
        </label>
      </div>

      {wildcard && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
          This role holds the <span className="font-mono">*</span> wildcard — every permission is implicitly granted.
          The wildcard cannot be removed from <span className="font-mono">SUPER_ADMIN</span>.
        </div>
      )}

      <div className="grid gap-4">
        {Array.from(grouped.entries()).map(([group, items]) => {
          const groupOn = items.every((p) => perms.has(p.key)) || wildcard;
          const someOn = items.some((p) => perms.has(p.key)) && !groupOn;
          return (
            <section key={group} className="grid gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/55">
                  {group}
                  {someOn && <Badge tone="warn">Partial</Badge>}
                  {groupOn && <Badge tone="success">All</Badge>}
                </div>
                {canWrite && !wildcard && (
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toggleGroup(group, true)}>
                      All
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleGroup(group, false)}>
                      None
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid gap-1.5">
                {items.map((p) => {
                  const on = wildcard || perms.has(p.key);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      disabled={!canWrite || wildcard}
                      onClick={() => toggle(p.key)}
                      className={cn(
                        'flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-all',
                        on
                          ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
                          : 'border-white/[0.06] bg-white/[0.02]',
                        !canWrite || wildcard ? 'cursor-default opacity-80' : 'hover:border-white/15',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          on ? 'border-emerald-400/50 bg-emerald-400/30' : 'border-white/15',
                        )}
                      >
                        {on && <CheckCircle2 className="h-3 w-3 text-emerald-200" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">{p.label}</div>
                        <div className="text-xs text-white/45">{p.description}</div>
                        <div className="mt-0.5 font-mono text-[10px] text-white/30">{p.key}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] pt-4">
        <div>
          {!role.isSystem && isSuper && (
            <Button variant="danger" size="sm" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete role
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/35">
            {wildcard ? 'All permissions' : `${perms.size} permission${perms.size === 1 ? '' : 's'} selected`}
          </span>
          <Button size="sm" onClick={save} disabled={!canWrite || !dirty || saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CreateRoleModal({
  catalog,
  onClose,
  onCreated,
}: {
  catalog: PermissionDef[];
  onClose: () => void;
  onCreated: (role: RoleSummary) => void;
}) {
  const toast = useToast();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seedFrom, setSeedFrom] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const seed = seedFrom
        ? catalog.filter((p) => p.group === seedFrom).map((p) => p.key)
        : [];
      const res = await api.createAdminRole({
        key: key.trim().toUpperCase(),
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: seed,
        rank: 50,
      });
      onCreated(res.data);
    } catch (err) {
      toast.push('error', (err as Error).message || 'Failed to create role');
    } finally {
      setSubmitting(false);
    }
  };

  const groups = Array.from(new Set(catalog.map((p) => p.group)));

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div className="text-sm font-semibold text-white">Create custom role</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={submit} className="grid gap-3 px-5 py-4">
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Key</span>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="ANALYST_PRO"
              required
              className="font-mono"
              pattern="[A-Z][A-Z0-9_]*"
              title="Uppercase letters, numbers, and underscores only"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Description</span>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Seed permissions from group (optional)</span>
            <Select value={seedFrom} onChange={(e) => setSeedFrom(e.target.value)}>
              <option value="">Start empty</option>
              {groups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Create role
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function setEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
