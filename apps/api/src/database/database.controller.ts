import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Controller('database')
export class DatabaseController {
  constructor(private readonly db: DatabaseService) {}

  @Get('tables')
  listTables() {
    return { success: true, data: this.db.listTables() };
  }

  @Get('stats')
  async stats() {
    return { success: true, data: await this.db.stats() };
  }

  @Get('tables/:name/schema')
  schema(@Param('name') name: string) {
    return { success: true, data: this.db.getTableMeta(name) };
  }

  @Get('tables/:name')
  async list(
    @Param('name') name: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search?: string,
    @Query('sortField') sortField?: string,
    @Query('sortDir') sortDir?: 'asc' | 'desc',
  ) {
    const result = await this.db.list(name, {
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
  ) {
    const { rows, table } = await this.db.export(name, {
      search: search?.trim() || undefined,
      sortField,
      sortDir,
    });
    return { success: true, data: rows, meta: { table: table.name, count: rows.length } };
  }

  @Post('tables/:name')
  async create(@Param('name') name: string, @Body() body: Record<string, unknown>) {
    const row = await this.db.create(name, body);
    return { success: true, data: row };
  }

  @Patch('tables/:name/:id')
  async update(
    @Param('name') name: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const row = await this.db.update(name, id, body);
    return { success: true, data: row };
  }

  @Delete('tables/:name/:id')
  async remove(@Param('name') name: string, @Param('id') id: string) {
    return { success: true, data: await this.db.remove(name, id) };
  }

  @Post('tables/:name/bulk-delete')
  async bulkDelete(@Param('name') name: string, @Body() body: { ids: string[] }) {
    return { success: true, data: await this.db.removeMany(name, body?.ids ?? []) };
  }
}
