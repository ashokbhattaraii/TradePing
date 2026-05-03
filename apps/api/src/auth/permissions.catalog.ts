/**
 * Central catalog of all permission keys used in the system.
 *
 * Adding a new permission:
 *   1. Add to PERMISSION_CATALOG below with a stable key + human label.
 *   2. Reference it from a controller via @RequirePermissions('your.key').
 *   3. Optionally include it in a default role's seed (migration) or have an
 *      admin grant it via the Roles UI.
 *
 * The wildcard '*' grants all permissions and is reserved for SUPER_ADMIN.
 */

export const WILDCARD_PERMISSION = '*';

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export const PERMISSION_CATALOG: PermissionDef[] = [
  // ── Users ────────────────────────────────────────────────────────────────
  { key: 'users.read', label: 'View users', group: 'Users', description: 'List and inspect user accounts.' },
  { key: 'users.write', label: 'Edit users', group: 'Users', description: 'Update user role, name, and metadata.' },
  { key: 'users.suspend', label: 'Suspend / reactivate', group: 'Users', description: 'Block or restore account access.' },
  { key: 'users.invite', label: 'Invite users', group: 'Users', description: 'Pre-provision an account before first login.' },
  { key: 'users.delete', label: 'Delete users', group: 'Users', description: 'Permanently remove a user account.' },

  // ── Roles & permissions ─────────────────────────────────────────────────
  { key: 'roles.read', label: 'View roles', group: 'Roles', description: 'View roles and their permissions.' },
  { key: 'roles.write', label: 'Edit roles', group: 'Roles', description: 'Create, edit, or delete roles and their permission sets.' },
  { key: 'permissions.assign', label: 'Assign permissions', group: 'Roles', description: 'Grant or revoke individual permissions on a user.' },

  // ── Alerts & watchlists ────────────────────────────────────────────────
  { key: 'alerts.view_all', label: 'View all alerts', group: 'Alerts', description: 'See alerts across every user.' },
  { key: 'alerts.manage_all', label: 'Manage all alerts', group: 'Alerts', description: 'Modify or delete alerts owned by any user.' },
  { key: 'watchlists.view_all', label: 'View all watchlists', group: 'Watchlists', description: 'See every user’s watchlists.' },
  { key: 'watchlists.manage_all', label: 'Manage all watchlists', group: 'Watchlists', description: 'Modify or delete any user’s watchlists.' },

  // ── Crawler / market ───────────────────────────────────────────────────
  { key: 'crawler.view', label: 'View crawler state', group: 'Crawler', description: 'See debug state and progress.' },
  { key: 'crawler.control', label: 'Control crawler', group: 'Crawler', description: 'Run manual checks, refresh, and clear cache.' },

  // ── System ─────────────────────────────────────────────────────────────
  { key: 'settings.read', label: 'View settings', group: 'System', description: 'Read system configuration.' },
  { key: 'settings.write', label: 'Edit settings', group: 'System', description: 'Modify system configuration.' },
  { key: 'database.access', label: 'Database tools', group: 'System', description: 'Open the generic database panel.' },
  { key: 'notifications.manage', label: 'Manage notifications', group: 'System', description: 'Edit notification channels, templates, and rules system-wide.' },
  { key: 'logs.view_all', label: 'View all logs', group: 'System', description: 'Read crawler/system logs system-wide.' },
  { key: 'audit.view', label: 'View audit log', group: 'System', description: 'Inspect security and admin audit events.' },
];

export const PERMISSION_KEYS = PERMISSION_CATALOG.map((p) => p.key);
export const PERMISSION_KEY_SET = new Set(PERMISSION_KEYS);

export function isKnownPermission(key: string): boolean {
  return key === WILDCARD_PERMISSION || PERMISSION_KEY_SET.has(key);
}

export function permissionsByGroup(): Record<string, PermissionDef[]> {
  return PERMISSION_CATALOG.reduce<Record<string, PermissionDef[]>>((acc, p) => {
    (acc[p.group] ||= []).push(p);
    return acc;
  }, {});
}
