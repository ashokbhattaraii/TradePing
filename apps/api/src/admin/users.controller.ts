import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AdminUsersService, type UserStatus } from './users.service';

@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @RequirePermissions('users.read')
  @Get()
  async list(
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('status') status?: UserStatus,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const result = await this.users.list({
      search: search?.trim() || undefined,
      role: role?.trim() || undefined,
      status,
      page: Number(page) || 1,
      limit: Number(limit) || 50,
    });
    return {
      success: true,
      data: result.rows,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  }

  @RequirePermissions('users.read')
  @Get('stats')
  async stats() {
    return { success: true, data: await this.users.stats() };
  }

  @RequirePermissions('users.read')
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return { success: true, data: await this.users.getOne(id) };
  }

  @RequirePermissions('users.write')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { role?: string; status?: UserStatus; name?: string },
    @CurrentUser() actor: AuthUser,
  ) {
    return { success: true, data: await this.users.update(actor, id, body) };
  }

  @RequirePermissions('permissions.assign')
  @Patch(':id/permissions')
  async setPermissions(
    @Param('id') id: string,
    @Body() body: { grants?: string[]; revokes?: string[] },
    @CurrentUser() actor: AuthUser,
  ) {
    return { success: true, data: await this.users.setOverrides(actor, id, body) };
  }

  @RequirePermissions('users.invite')
  @Post('invite')
  async invite(@Body() body: { email: string; role?: string; name?: string }, @CurrentUser() actor: AuthUser) {
    return { success: true, data: await this.users.invite(actor, body) };
  }

  @RequirePermissions('users.delete')
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return { success: true, data: await this.users.remove(actor, id) };
  }
}
