import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../auth/permissions.service';
import { isKnownPermission, WILDCARD_PERMISSION } from '../auth/permissions.catalog';
import type { AuthUser } from '../auth/auth.types';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'INVITED';

export interface ListUsersOpts {
  search?: string;
  role?: string;
  status?: UserStatus;
  page: number;
  limit: number;
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  async list(opts: ListUsersOpts) {
    const limit = Math.min(Math.max(opts.limit, 1), 200);
    const page = Math.max(opts.page, 1);

    const where: Record<string, unknown> = {};
    if (opts.search) {
      where.OR = [
        { email: { contains: opts.search, mode: 'insensitive' } },
        { name: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.role) where.role = opts.role;
    if (opts.status) where.status = opts.status;

    const [rows, total, roleRows] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: this.publicSelect(),
      }),
      this.prisma.user.count({ where }),
      this.permissions.listRoles(),
    ]);

    const enriched = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        effectivePermissions: await this.effectivePermissions(r.role, r.permissionsGrant, r.permissionsRevoke, roleRows),
      })),
    );

    return { rows: enriched, total, page, limit };
  }

  async getOne(id: string) {
    const row = await this.prisma.user.findUnique({ where: { id }, select: this.publicSelect() });
    if (!row) throw new NotFoundException('User not found');
    const roles = await this.permissions.listRoles();
    return {
      ...row,
      effectivePermissions: await this.effectivePermissions(
        row.role,
        row.permissionsGrant,
        row.permissionsRevoke,
        roles,
      ),
    };
  }

  async update(actor: AuthUser, id: string, body: { role?: string; status?: UserStatus; name?: string }) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    const data: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const trimmed = String(body.name).trim();
      if (!trimmed) throw new BadRequestException('Name cannot be empty');
      data.name = trimmed;
    }

    if (body.role && body.role !== target.role) {
      const role = await this.permissions.getRole(body.role);
      if (!role) throw new BadRequestException(`Unknown role: ${body.role}`);
      this.assertCanAssignRole(actor, target, body.role);
      data.role = body.role;
    }

    if (body.status && body.status !== target.status) {
      if (!['ACTIVE', 'SUSPENDED', 'INVITED'].includes(body.status)) {
        throw new BadRequestException(`Unknown status: ${body.status}`);
      }
      if (id === actor.id && body.status === 'SUSPENDED') {
        throw new BadRequestException('You cannot suspend your own account');
      }
      this.assertCanModerate(actor, target);
      data.status = body.status;
    }

    if (Object.keys(data).length === 0) {
      return this.getOne(id);
    }

    await this.prisma.user.update({ where: { id }, data });
    this.permissions.invalidateUser(id);
    return this.getOne(id);
  }

  async setOverrides(actor: AuthUser, id: string, body: { grants?: string[]; revokes?: string[] }) {
    if (!this.actorHas(actor, 'permissions.assign')) {
      throw new ForbiddenException('Missing permission: permissions.assign');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    const grants = this.permissions.filterValidPermissions(body.grants ?? target.permissionsGrant);
    const revokes = this.permissions.filterValidPermissions(body.revokes ?? target.permissionsRevoke);
    // A grant and a revoke for the same key cancel out — drop from revokes.
    const grantSet = new Set(grants);
    const cleanRevokes = revokes.filter((r) => !grantSet.has(r));

    await this.prisma.user.update({
      where: { id },
      data: { permissionsGrant: grants, permissionsRevoke: cleanRevokes },
    });
    this.permissions.invalidateUser(id);
    return this.getOne(id);
  }

  async remove(actor: AuthUser, id: string) {
    if (id === actor.id) {
      throw new BadRequestException('You cannot delete your own account');
    }
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    this.assertCanModerate(actor, target);
    if (target.role === 'SUPER_ADMIN' && !this.actorHas(actor, WILDCARD_PERMISSION)) {
      throw new ForbiddenException('Only a super admin can delete a super admin');
    }
    await this.prisma.user.delete({ where: { id } });
    this.permissions.invalidateUser(id);
    return { id };
  }

  async invite(actor: AuthUser, body: { email: string; role?: string; name?: string }) {
    if (!this.actorHas(actor, 'users.invite')) {
      throw new ForbiddenException('Missing permission: users.invite');
    }
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new BadRequestException('A valid email is required');
    }
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('A user with this email already exists');
    }
    const role = body.role ?? 'USER';
    const roleRow = await this.permissions.getRole(role);
    if (!roleRow) throw new BadRequestException(`Unknown role: ${role}`);
    this.assertCanAssignRole(actor, null, role);

    // INVITED rows have no Google sub yet — Google OAuth attaches the sub on
    // first login by matching email and flipping status to ACTIVE.
    const placeholderSub = `invite:${email}:${Date.now()}`;
    const created = await this.prisma.user.create({
      data: {
        email,
        name: body.name?.trim() || email,
        googleSub: placeholderSub,
        role,
        status: 'INVITED',
        invitedBy: actor.id,
        invitedAt: new Date(),
      },
      select: this.publicSelect(),
    });
    return created;
  }

  async stats() {
    const [byStatus, byRole, total, recentLogins] = await Promise.all([
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.user.count(),
      this.prisma.user.count({
        where: { lastLoginAt: { gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
    ]);
    return {
      total,
      activeLast7Days: recentLogins,
      byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      byRole: Object.fromEntries(byRole.map((g) => [g.role, g._count._all])),
    };
  }

  private publicSelect() {
    return {
      id: true,
      email: true,
      name: true,
      picture: true,
      role: true,
      status: true,
      permissionsGrant: true,
      permissionsRevoke: true,
      lastLoginAt: true,
      invitedBy: true,
      invitedAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private async effectivePermissions(
    roleKey: string,
    grants: string[],
    revokes: string[],
    roles: { key: string; permissions: string[] }[],
  ) {
    const role = roles.find((r) => r.key === roleKey);
    const set = new Set<string>();
    if (role) for (const p of role.permissions) set.add(p);
    for (const p of grants) if (isKnownPermission(p)) set.add(p);
    for (const p of revokes) set.delete(p);
    return Array.from(set).sort();
  }

  private actorHas(actor: AuthUser, key: string): boolean {
    const perms = actor.permissions ?? [];
    return perms.includes(WILDCARD_PERMISSION) || perms.includes(key);
  }

  private assertCanModerate(actor: AuthUser, target: { id: string; role: string }) {
    if (this.actorHas(actor, WILDCARD_PERMISSION)) return;
    if (target.role === 'SUPER_ADMIN') {
      throw new ForbiddenException('Only a super admin can modify another super admin');
    }
    if (target.role === 'ADMIN' && !this.actorHas(actor, 'users.write')) {
      throw new ForbiddenException('Modifying an administrator requires users.write');
    }
  }

  private assertCanAssignRole(actor: AuthUser, _target: { role: string } | null, roleKey: string) {
    if (this.actorHas(actor, WILDCARD_PERMISSION)) return;
    // Only SUPER_ADMIN may grant SUPER_ADMIN or ADMIN.
    if (roleKey === 'SUPER_ADMIN' || roleKey === 'ADMIN') {
      throw new ForbiddenException('Only a super admin can assign this role');
    }
    if (!this.actorHas(actor, 'users.write')) {
      throw new ForbiddenException('Missing permission: users.write');
    }
  }
}
