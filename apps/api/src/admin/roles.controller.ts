import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AdminRolesService } from './roles.service';

@Controller('admin/roles')
export class AdminRolesController {
  constructor(private readonly roles: AdminRolesService) {}

  @RequirePermissions('roles.read')
  @Get()
  async list() {
    return { success: true, data: await this.roles.list() };
  }

  @RequirePermissions('roles.read')
  @Get(':key')
  async getOne(@Param('key') key: string) {
    return { success: true, data: await this.roles.getOne(key) };
  }

  @RequirePermissions('roles.write')
  @Post()
  async create(
    @Body() body: { key: string; name: string; description?: string; permissions?: string[]; rank?: number },
    @CurrentUser() actor: AuthUser,
  ) {
    return { success: true, data: await this.roles.create(actor, body) };
  }

  @RequirePermissions('roles.write')
  @Patch(':key')
  async update(
    @Param('key') key: string,
    @Body() body: { name?: string; description?: string; permissions?: string[]; rank?: number },
    @CurrentUser() actor: AuthUser,
  ) {
    return { success: true, data: await this.roles.update(actor, key, body) };
  }

  @RequirePermissions('roles.write')
  @Delete(':key')
  async remove(@Param('key') key: string, @CurrentUser() actor: AuthUser) {
    return { success: true, data: await this.roles.remove(actor, key) };
  }
}
