import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { NotificationEvent } from '@tradeping/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { TemplatesService, type UpsertTemplateDto } from './templates.service';

@Controller('notifications/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.templates.findAll(user.id) };
  }

  @Get('defaults')
  defaults() {
    return { success: true, data: this.templates.defaults() };
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.templates.findOne(id, user.id) };
  }

  @Post()
  async create(@Body() body: UpsertTemplateDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.templates.create(body, user.id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<UpsertTemplateDto>, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.templates.update(id, body, user.id) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.templates.remove(id, user.id) };
  }

  @Post('preview')
  preview(@Body() body: { body: string; event?: NotificationEvent }) {
    return { success: true, data: { rendered: this.templates.preview(body.body, body.event) } };
  }
}
