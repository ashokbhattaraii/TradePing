'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  KeyRound,
  Loader2,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import {
  api,
  type AdminUser,
  type PermissionDef,
  type RoleSummary,
  type RolesResponse,
  type UserStatsResponse,
  type UserStatus,
} from '@/lib/api';
import { useAuth } from './auth-provider';
import { hasPermission, isSuperAdmin } from '@/lib/permissions';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input, Select } from './ui/input';
import { Badge } from './ui/badge';
import { useToast } from './ui/toast';
import { cn } from '@/lib/utils';

type StatusFilter = '' | UserStatus;

const PAGE_SIZE = 25;

const STATUS_TONE: Record<UserStatus, 'success' | 'warn' | 'danger' | 'info'> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'danger',
};

const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Active',
  INVITED: 'Invited',
  SUSPENDED: 'Suspended',
};

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function UsersPanel() {
  const toast = useToast();
  const { user: me } = useAuth();
  const canRead = hasPermission(me, 'users.read');
  const canWrite = hasPermission(me, 'users.write');
  const canSuspend = hasPermission(me, 'users.suspend');
  const canDelete = hasPermission(me, 'users.delete');
  const canInvite = hasPermission(me, 'users.invite');
  const canAssignPerms = hasPermission(me, 'permissions.assign');

  const [rows, setRows] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [stats, setStats] = useState<UserStatsResponse | null>(null);
  const [rolesData, setRolesData] = useState<RolesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const loadStats = useCallback(() => {
    if (!canRead) return;
    api
      .getAdminUserStats()
      .then((res) => setStats(res.data))
      .catch(() => {});
  }, [canRead]);

  const loadRoles = useCallback(() => {
    if (!canRead) return;
    api
      .listAdminRoles()
      .then((res) => setRolesData(res.data))
      .catch(() => {});
  }, [canRead]);

  const loadUsers = useCallback(
    async (showSpinner = false) => {
      if (!canRead) return;
      if (showSpinner) setRefreshing(true);
      try {
        const res = await api.listAdminUsers({
          search: search || undefined,
          role: roleFilter || undefined,
          status: statusFilter || undefined,
          page,
          limit: PAGE_SIZE,
        });
        setRows(res.data);
        setTotal(res.meta.total);
      } catch (err) {
        toast.push("error", (err as Error).message || 'Failed to load users');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canRead, search, roleFilter, statusFilter, page, toast],
  );

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    loadStats();
    loadRoles();
  }, [loadStats, loadRoles]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter]);

  if (!canRead) {
    return (
      <Card className="p-8 text-sm text-white/55">
        <div className="flex items-center gap-2 text-white/70">
          <Shield className="h-4 w-4" /> You don’t have permission to view users.
        </div>
      </Card>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = () => {
    void loadUsers(true);
    loadStats();
  };

  const handleSuspendToggle = async (row: AdminUser) => {
    const next: UserStatus = row.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      const res = await api.updateAdminUser(row.id, { status: next });
      setRows((prev) => prev.map((r) => (r.id === row.id ? res.data : r)));
      toast.push("success", next === 'SUSPENDED' ? 'User suspended' : 'User reactivated');
      loadStats();
    } catch (err) {
      toast.push("error", (err as Error).message || 'Failed to update status');
    }
  };

  const handleDelete = async (row: AdminUser) => {
    if (!window.confirm(`Permanently delete ${row.email}? This cannot be undone.`)) return;
    try {
      await api.deleteAdminUser(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.push("success", 'User deleted');
      loadStats();
    } catch (err) {
      toast.push("error", (err as Error).message || 'Failed to delete user');
    }
  };

  return (
    <div className="grid gap-5 animate-fade-in">
      <Header
        stats={stats}
        onRefresh={refresh}
        refreshing={refreshing}
        canInvite={canInvite}
        onInvite={() => setInviteOpen(true)}
      />

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr,180px,180px] sm:items-center">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <Input
              placeholder="Search by email or name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {rolesData?.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name} ({r.userCount})
              </option>
            ))}
          </Select>
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INVITED">Invited</option>
            <option value="SUSPENDED">Suspended</option>
          </Select>
        </div>
      </Card>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-white/55">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading users…
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-white/45">No users match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/[0.06] bg-white/[0.02] text-[11px] uppercase tracking-wider text-white/45">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">User</th>
                  <th className="px-4 py-3 text-left font-medium">Role</th>
                  <th className="px-4 py-3 text-left font-medium">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Permissions</th>
                  <th className="px-4 py-3 text-left font-medium">Last login</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <UserRow
                    key={row.id}
                    row={row}
                    isMe={row.id === me.id}
                    canWrite={canWrite}
                    canSuspend={canSuspend}
                    canDelete={canDelete}
                    canAssignPerms={canAssignPerms}
                    superAdminViewer={isSuperAdmin(me)}
                    onEdit={() => setEditing(row)}
                    onSuspendToggle={() => handleSuspendToggle(row)}
                    onDelete={() => handleDelete(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3 text-xs text-white/55">
            <span>
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {editing && rolesData && (
        <EditUserDrawer
          user={editing}
          roles={rolesData.roles}
          catalog={rolesData.catalog}
          superAdminViewer={isSuperAdmin(me)}
          canAssignPerms={canAssignPerms}
          canWrite={canWrite}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
            setEditing(updated);
            loadStats();
          }}
        />
      )}

      {inviteOpen && rolesData && (
        <InviteUserModal
          roles={rolesData.roles}
          superAdminViewer={isSuperAdmin(me)}
          onClose={() => setInviteOpen(false)}
          onInvited={(u) => {
            toast.push("success", `${u.email} invited`);
            setInviteOpen(false);
            void loadUsers(true);
            loadStats();
          }}
        />
      )}
    </div>
  );
}

function Header({
  stats,
  onRefresh,
  refreshing,
  canInvite,
  onInvite,
}: {
  stats: UserStatsResponse | null;
  onRefresh: () => void;
  refreshing: boolean;
  canInvite: boolean;
  onInvite: () => void;
}) {
  const tiles = useMemo(
    () => [
      { label: 'Total users', value: stats?.total ?? '—', icon: UsersIcon, tint: 'text-white' },
      { label: 'Active 7d', value: stats?.activeLast7Days ?? '—', icon: CheckCircle2, tint: 'text-emerald-300' },
      { label: 'Suspended', value: stats?.byStatus.SUSPENDED ?? 0, icon: PauseCircle, tint: 'text-rose-300' },
      { label: 'Invited', value: stats?.byStatus.INVITED ?? 0, icon: Mail, tint: 'text-blue-300' },
    ],
    [stats],
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Users & access</h2>
          <p className="text-xs text-white/45">Manage roles, statuses, and per-user permissions.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          {canInvite && (
            <Button size="sm" onClick={onInvite}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Invite user
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <Card
            key={t.label}
            className="flex items-center gap-3 p-3 transition-transform hover:-translate-y-0.5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white/[0.04]">
              <t.icon className={cn('h-4 w-4', t.tint)} />
            </span>
            <div>
              <div className={cn('font-mono text-lg font-semibold', t.tint)}>{t.value}</div>
              <div className="text-[11px] uppercase tracking-wider text-white/45">{t.label}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UserRow({
  row,
  isMe,
  canWrite,
  canSuspend,
  canDelete,
  canAssignPerms,
  superAdminViewer,
  onEdit,
  onSuspendToggle,
  onDelete,
}: {
  row: AdminUser;
  isMe: boolean;
  canWrite: boolean;
  canSuspend: boolean;
  canDelete: boolean;
  canAssignPerms: boolean;
  superAdminViewer: boolean;
  onEdit: () => void;
  onSuspendToggle: () => void;
  onDelete: () => void;
}) {
  const overrideCount = row.permissionsGrant.length + row.permissionsRevoke.length;
  const isProtected = row.role === 'SUPER_ADMIN' && !superAdminViewer;
  const allowEdit = canWrite && !isProtected;
  const allowSuspend = canSuspend && !isMe && !isProtected;
  const allowDelete = canDelete && !isMe && !isProtected;

  return (
    <tr className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          {row.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.picture} alt="" className="h-8 w-8 rounded-full border border-white/10" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold uppercase text-white/70">
              {row.name?.[0] ?? row.email[0]}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-medium text-white">
              <span className="truncate">{row.name}</span>
              {isMe && <Badge tone="info">You</Badge>}
            </div>
            <div className="truncate text-xs text-white/45">{row.email}</div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <RoleBadge role={row.role} />
      </td>
      <td className="px-4 py-3">
        <Badge tone={STATUS_TONE[row.status]} dot={row.status === 'ACTIVE'}>
          {STATUS_LABEL[row.status]}
        </Badge>
      </td>
      <td className="px-4 py-3 text-xs text-white/55">
        <div className="flex items-center gap-1.5">
          <KeyRound className="h-3 w-3 text-white/35" />
          <span className="font-mono">{row.effectivePermissions.length}</span>
          {overrideCount > 0 && (
            <Badge tone="warn">{overrideCount} override{overrideCount === 1 ? '' : 's'}</Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-white/55">
        <div className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-white/35" />
          {formatRelative(row.lastLoginAt)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {(allowEdit || canAssignPerms) && (
            <Button variant="ghost" size="sm" onClick={onEdit} title="Edit user">
              <ShieldCheck className="h-3.5 w-3.5" />
            </Button>
          )}
          {allowSuspend && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSuspendToggle}
              title={row.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
            >
              {row.status === 'SUSPENDED' ? (
                <PlayCircle className="h-3.5 w-3.5 text-emerald-300" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5 text-rose-300" />
              )}
            </Button>
          )}
          {allowDelete && (
            <Button variant="ghost" size="sm" onClick={onDelete} title="Delete user">
              <Trash2 className="h-3.5 w-3.5 text-rose-300" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'SUPER_ADMIN'
      ? 'danger'
      : role === 'ADMIN'
        ? 'warn'
        : role === 'MODERATOR'
          ? 'info'
          : role === 'ANALYST'
            ? 'success'
            : 'default';
  return <Badge tone={tone}>{role}</Badge>;
}

function EditUserDrawer({
  user,
  roles,
  catalog,
  superAdminViewer,
  canAssignPerms,
  canWrite,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  roles: RoleSummary[];
  catalog: PermissionDef[];
  superAdminViewer: boolean;
  canAssignPerms: boolean;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [grants, setGrants] = useState<Set<string>>(new Set(user.permissionsGrant));
  const [revokes, setRevokes] = useState<Set<string>>(new Set(user.permissionsRevoke));
  const [saving, setSaving] = useState(false);

  const baseRolePerms = useMemo(() => {
    const r = roles.find((rr) => rr.key === role);
    return new Set(r?.permissions ?? []);
  }, [role, roles]);

  const grouped = useMemo(() => {
    const map = new Map<string, PermissionDef[]>();
    for (const p of catalog) {
      if (!map.has(p.group)) map.set(p.group, []);
      map.get(p.group)!.push(p);
    }
    return map;
  }, [catalog]);

  const togglePermission = (key: string) => {
    if (!canAssignPerms) return;
    const inBase = baseRolePerms.has(key) || baseRolePerms.has('*');
    const isGranted = grants.has(key);
    const isRevoked = revokes.has(key);
    const nextGrants = new Set(grants);
    const nextRevokes = new Set(revokes);

    if (inBase) {
      // Cycle: enabled → revoked → enabled
      if (isRevoked) nextRevokes.delete(key);
      else nextRevokes.add(key);
      nextGrants.delete(key);
    } else {
      // Cycle: disabled → granted → disabled
      if (isGranted) nextGrants.delete(key);
      else nextGrants.add(key);
      nextRevokes.delete(key);
    }
    setGrants(nextGrants);
    setRevokes(nextRevokes);
  };

  const save = async () => {
    setSaving(true);
    try {
      let current = user;
      if (canWrite && (name !== user.name || role !== user.role || status !== user.status)) {
        const res = await api.updateAdminUser(user.id, { name, role, status });
        current = res.data;
      }
      if (canAssignPerms) {
        const res = await api.setAdminUserPermissions(user.id, {
          grants: Array.from(grants),
          revokes: Array.from(revokes),
        });
        current = res.data;
      }
      toast.push("success", 'User updated');
      onSaved(current);
      onClose();
    } catch (err) {
      toast.push("error", (err as Error).message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const isProtected = user.role === 'SUPER_ADMIN' && !superAdminViewer;
  const roleLocked = isProtected || !canWrite;
  const wildcard = baseRolePerms.has('*');

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-stretch justify-end bg-black/60 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/10 bg-[#0b0b0e] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <div>
            <div className="text-sm font-semibold text-white">{user.email}</div>
            <div className="text-xs text-white/45">Edit user · {user.id.slice(0, 10)}…</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 gap-5 overflow-y-auto px-6 py-5">
          <section className="grid gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45">Profile</div>
            <label className="grid gap-1.5">
              <span className="text-xs text-white/55">Name</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
            </label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <span className="text-xs text-white/55">Role</span>
                <Select value={role} onChange={(e) => setRole(e.target.value)} disabled={roleLocked}>
                  {roles.map((r) => (
                    <option
                      key={r.key}
                      value={r.key}
                      disabled={
                        !superAdminViewer && (r.key === 'SUPER_ADMIN' || r.key === 'ADMIN')
                      }
                    >
                      {r.name} {r.isSystem ? '· system' : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs text-white/55">Status</span>
                <Select value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} disabled={!canWrite}>
                  <option value="ACTIVE">Active</option>
                  <option value="INVITED">Invited</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              </label>
            </div>
          </section>

          <section className="grid gap-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
                  Permissions
                </div>
                <p className="text-xs text-white/45">
                  {canAssignPerms
                    ? 'Click any permission to grant or revoke it for this user. Role defaults are highlighted.'
                    : 'You can view but not edit permissions.'}
                </p>
              </div>
              {(grants.size > 0 || revokes.size > 0) && canAssignPerms && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setGrants(new Set());
                    setRevokes(new Set());
                  }}
                >
                  Reset overrides
                </Button>
              )}
            </div>

            {wildcard && (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
                This role holds the <span className="font-mono">*</span> wildcard — every permission is implicitly
                granted. Per-user revokes are ignored.
              </div>
            )}

            <div className="grid gap-4">
              {Array.from(grouped.entries()).map(([group, perms]) => (
                <div key={group} className="grid gap-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/35">{group}</div>
                  <div className="grid gap-1.5">
                    {perms.map((p) => {
                      const inBase = baseRolePerms.has(p.key) || wildcard;
                      const granted = grants.has(p.key);
                      const revoked = revokes.has(p.key);
                      const effective = wildcard || (inBase && !revoked) || granted;
                      return (
                        <button
                          key={p.key}
                          type="button"
                          disabled={!canAssignPerms || wildcard}
                          onClick={() => togglePermission(p.key)}
                          className={cn(
                            'group flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all',
                            effective
                              ? 'border-emerald-400/20 bg-emerald-400/[0.04]'
                              : 'border-white/[0.06] bg-white/[0.02]',
                            !canAssignPerms || wildcard ? 'cursor-default opacity-80' : 'hover:border-white/15',
                          )}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-white">
                              <span
                                className={cn(
                                  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                  effective
                                    ? 'border-emerald-400/50 bg-emerald-400/30'
                                    : 'border-white/15',
                                )}
                              >
                                {effective && <CheckCircle2 className="h-3 w-3 text-emerald-200" />}
                              </span>
                              {p.label}
                              {granted && <Badge tone="success">Granted</Badge>}
                              {revoked && <Badge tone="danger">Revoked</Badge>}
                              {inBase && !granted && !revoked && !wildcard && (
                                <Badge>Role default</Badge>
                              )}
                            </div>
                            <div className="mt-0.5 pl-6 text-xs text-white/45">{p.description}</div>
                            <div className="mt-0.5 pl-6 font-mono text-[10px] text-white/30">{p.key}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] bg-white/[0.02] px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

function InviteUserModal({
  roles,
  superAdminViewer,
  onClose,
  onInvited,
}: {
  roles: RoleSummary[];
  superAdminViewer: boolean;
  onClose: () => void;
  onInvited: (u: AdminUser) => void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('USER');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.inviteAdminUser({ email, name: name || undefined, role });
      onInvited(res.data);
    } catch (err) {
      toast.push("error", (err as Error).message || 'Failed to invite');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <Card className="w-full max-w-md p-0">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <UserPlus className="h-4 w-4 text-emerald-300" /> Invite a user
            </div>
            <p className="mt-0.5 text-xs text-white/45">
              They’ll be activated automatically the first time they sign in with Google.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <form onSubmit={submit} className="grid gap-3 px-5 py-4">
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Email</span>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Display name (optional)</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs text-white/55">Role</span>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option
                  key={r.key}
                  value={r.key}
                  disabled={!superAdminViewer && (r.key === 'SUPER_ADMIN' || r.key === 'ADMIN')}
                >
                  {r.name}
                </option>
              ))}
            </Select>
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              Send invite
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
