import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { RulesService, type UpsertRuleDto } from './rules.service';

@Controller('notifications/rules')
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.rules.findAll(user.id) };
  }

  @Post()
  async create(@Body() body: UpsertRuleDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.rules.create(body, user.id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<UpsertRuleDto>, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.rules.update(id, body, user.id) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.rules.remove(id, user.id) };
  }
}
