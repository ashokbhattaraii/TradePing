import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOG, WILDCARD_PERMISSION, isKnownPermission } from './permissions.catalog';

export interface RoleSnapshot {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  rank: number;
  permissions: string[];
}

interface UserPermSnapshot {
  id: string;
  role: string;
  status: string;
  grants: string[];
  revokes: string[];
  expiresAt: number;
}

const USER_CACHE_TTL_MS = 15_000;
const ROLE_CACHE_TTL_MS = 30_000;

/**
 * Resolves effective permissions for a user. Caches role table and per-user
 * snapshots briefly so guards don't hammer the DB on every request, while
 * still reflecting role/permission/status edits within ~30 seconds.
 */
@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);
  private rolesCache: { roles: Map<string, RoleSnapshot>; expiresAt: number } | null = null;
  private userCache = new Map<string, UserPermSnapshot>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Warm role cache eagerly so the first protected request doesn't pay the latency.
    await this.loadRoles().catch((err) => this.logger.warn(`Role cache warmup failed: ${(err as Error).message}`));
  }

  invalidateUser(userId?: string) {
    if (userId) this.userCache.delete(userId);
    else this.userCache.clear();
  }

  invalidateRoles() {
    this.rolesCache = null;
  }

  async listRoles(): Promise<RoleSnapshot[]> {
    const map = await this.loadRoles();
    return Array.from(map.values()).sort((a, b) => a.rank - b.rank);
  }

  async getRole(key: string): Promise<RoleSnapshot | null> {
    const map = await this.loadRoles();
    return map.get(key) ?? null;
  }

  /**
   * Returns the merged permission set for a user, or null if the user has
   * been suspended (caller should reject the request).
   */
  async resolveUserPermissions(userId: string): Promise<{ permissions: Set<string>; status: string; role: string } | null> {
    const snap = await this.loadUser(userId);
    if (!snap) return null;
    const roles = await this.loadRoles();
    const role = roles.get(snap.role);
    const permissions = new Set<string>();
    if (role) {
      for (const p of role.permissions) permissions.add(p);
    }
    for (const p of snap.grants) permissions.add(p);
    for (const p of snap.revokes) permissions.delete(p);
    return { permissions, status: snap.status, role: snap.role };
  }

  hasPermission(permissions: Set<string>, required: string): boolean {
    return permissions.has(WILDCARD_PERMISSION) || permissions.has(required);
  }

  hasAll(permissions: Set<string>, required: string[]): boolean {
    if (permissions.has(WILDCARD_PERMISSION)) return true;
    return required.every((r) => permissions.has(r));
  }

  hasAny(permissions: Set<string>, required: string[]): boolean {
    if (permissions.has(WILDCARD_PERMISSION)) return true;
    return required.some((r) => permissions.has(r));
  }

  filterValidPermissions(input: unknown): string[] {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    for (const raw of input) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed || !isKnownPermission(trimmed)) continue;
      seen.add(trimmed);
    }
    return Array.from(seen);
  }

  catalog() {
    return PERMISSION_CATALOG;
  }

  private async loadRoles(): Promise<Map<string, RoleSnapshot>> {
    if (this.rolesCache && this.rolesCache.expiresAt > Date.now()) return this.rolesCache.roles;
    const rows = await this.prisma.role.findMany();
    const map = new Map<string, RoleSnapshot>();
    for (const r of rows) {
      map.set(r.key, {
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        rank: r.rank,
        permissions: r.permissions ?? [],
      });
    }
    this.rolesCache = { roles: map, expiresAt: Date.now() + ROLE_CACHE_TTL_MS };
    return map;
  }

  private async loadUser(userId: string): Promise<UserPermSnapshot | null> {
    const cached = this.userCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, permissionsGrant: true, permissionsRevoke: true },
    });
    if (!row) return null;
    const snap: UserPermSnapshot = {
      id: row.id,
      role: row.role,
      status: row.status,
      grants: row.permissionsGrant ?? [],
      revokes: row.permissionsRevoke ?? [],
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    };
    this.userCache.set(userId, snap);
    return snap;
  }
}
