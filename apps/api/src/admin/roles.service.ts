import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../auth/permissions.service';
import { PERMISSION_CATALOG, WILDCARD_PERMISSION } from '../auth/permissions.catalog';
import type { AuthUser } from '../auth/auth.types';

@Injectable()
export class AdminRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async list() {
    const [roles, counts] = await Promise.all([
      this.permissions.listRoles(),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    ]);
    const userCount = Object.fromEntries(counts.map((c) => [c.role, c._count._all]));
    return {
      catalog: PERMISSION_CATALOG,
      roles: roles.map((r) => ({ ...r, userCount: userCount[r.key] ?? 0 })),
    };
  }

  async getOne(key: string) {
    const role = await this.permissions.getRole(key);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async create(actor: AuthUser, body: { key: string; name: string; description?: string; permissions?: string[]; rank?: number }) {
    this.assertSuperAdmin(actor);
    const key = String(body.key ?? '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new BadRequestException('Role key must be uppercase letters/numbers/underscores starting with a letter');
    }
    const existing = await this.permissions.getRole(key);
    if (existing) throw new BadRequestException('A role with this key already exists');
    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Role name is required');

    const permissions = this.permissions.filterValidPermissions(body.permissions ?? []);
    const created = await this.prisma.role.create({
      data: {
        key,
        name,
        description: body.description?.trim() || null,
        permissions,
        rank: typeof body.rank === 'number' ? body.rank : 50,
        isSystem: false,
      },
    });
    this.permissions.invalidateRoles();
    this.permissions.invalidateUser();
    return created;
  }

  async update(
    actor: AuthUser,
    key: string,
    body: { name?: string; description?: string; permissions?: string[]; rank?: number },
  ) {
    this.assertSuperAdmin(actor);
    const role = await this.permissions.getRole(key);
    if (!role) throw new NotFoundException('Role not found');

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) throw new BadRequestException('Role name cannot be empty');
      data.name = trimmed;
    }
    if (body.description !== undefined) {
      data.description = body.description?.trim() || null;
    }
    if (body.rank !== undefined) {
      data.rank = Number(body.rank) || 0;
    }
    if (body.permissions !== undefined) {
      const next = this.permissions.filterValidPermissions(body.permissions);
      // Don't let the SUPER_ADMIN role lose the wildcard — that would lock
      // everyone out of role/permission management.
      if (key === 'SUPER_ADMIN' && !next.includes(WILDCARD_PERMISSION)) {
        next.push(WILDCARD_PERMISSION);
      }
      data.permissions = next;
    }

    if (Object.keys(data).length === 0) return role;
    const updated = await this.prisma.role.update({ where: { key }, data });
    this.permissions.invalidateRoles();
    this.permissions.invalidateUser();
    return updated;
  }

  async remove(actor: AuthUser, key: string) {
    this.assertSuperAdmin(actor);
    const role = await this.permissions.getRole(key);
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    const inUse = await this.prisma.user.count({ where: { role: key } });
    if (inUse > 0) {
      throw new BadRequestException(
        `Cannot delete role: ${inUse} user${inUse === 1 ? '' : 's'} still hold it. Reassign them first.`,
      );
    }
    await this.prisma.role.delete({ where: { key } });
    this.permissions.invalidateRoles();
    return { key };
  }

  private assertSuperAdmin(actor: AuthUser) {
    const perms = actor.permissions ?? [];
    if (!perms.includes(WILDCARD_PERMISSION)) {
      throw new ForbiddenException('Only a super admin can edit roles');
    }
  }
}
