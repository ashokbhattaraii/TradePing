import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RequirePermissions } from '../auth/permissions.decorator';
import { WILDCARD_PERMISSION } from '../auth/permissions.catalog';
import { DatabaseService, type DbCaller } from './database.service';

function toCaller(user: AuthUser): DbCaller {
  const perms = new Set(user.permissions ?? []);
  return {
    id: user.id,
    isAdmin: perms.has(WILDCARD_PERMISSION) || perms.has('database.access'),
  };
}

@RequirePermissions('database.access')
@Controller('database')
export class DatabaseController {
  constructor(private readonly db: DatabaseService) {}

  @Get('tables')
  listTables(@CurrentUser() user: AuthUser) {
    return { success: true, data: this.db.listTables(toCaller(user)) };
  }

  @Get('stats')
  async stats(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.db.stats(toCaller(user)) };
  }

  @Get('tables/:name/schema')
  schema(@Param('name') name: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: this.db.getTableMeta(name, toCaller(user)) };
  }

  @Get('tables/:name')
  async list(
    @Param('name') name: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @CurrentUser() user?: AuthUser,
  ) {
    const result = await this.db.list(name, toCaller(user!), {
      page: Number(page) || 1,
      limit: Number(limit) || 50,
      search: search?.trim() || undefined,
      sortField,
      sortDir,
    });
    return {
      success: true,
      data: result.rows,
      meta: { total: result.total, page: result.page, limit: result.limit },
    };
  }

  @Get('tables/:name/export')
  async exportRows(
    @Param('name') name: string,
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
    @CurrentUser() user?: AuthUser,
  ) {
    const { rows, table } = await this.db.export(name, toCaller(user!), {
      search: search?.trim() || undefined,
      sortField,
      sortDir,
    });
    return { success: true, data: rows, meta: { table: table.name, count: rows.length } };
  }

  @Post('tables/:name')
  async create(
    @Param('name') name: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    const row = await this.db.create(name, body, toCaller(user));
    return { success: true, data: row };
  }

  @Patch('tables/:name/:id')
  async update(
    @Param('name') name: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    const row = await this.db.update(name, id, body, toCaller(user));
    return { success: true, data: row };
  }

  @Delete('tables/:name/:id')
  async remove(@Param('name') name: string, @Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.db.remove(name, id, toCaller(user)) };
  }

  @Post('tables/:name/bulk-delete')
  async bulkDelete(
    @Param('name') name: string,
    @Body() body: { ids: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return { success: true, data: await this.db.removeMany(name, body?.ids ?? [], toCaller(user)) };
  }
}
