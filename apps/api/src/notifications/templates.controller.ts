import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { NotificationEvent } from '@tradeping/types';
import { TemplatesService, type UpsertTemplateDto } from './templates.service';

@Controller('notifications/templates')
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  async list() {
    return { success: true, data: await this.templates.findAll() };
  }

  @Get('defaults')
  defaults() {
    return { success: true, data: this.templates.defaults() };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { success: true, data: await this.templates.findOne(id) };
  }

  @Post()
  async create(@Body() body: UpsertTemplateDto) {
    return { success: true, data: await this.templates.create(body) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<UpsertTemplateDto>) {
    return { success: true, data: await this.templates.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.templates.remove(id) };
  }

  @Post('preview')
  preview(@Body() body: { body: string; event?: NotificationEvent }) {
    return { success: true, data: { rendered: this.templates.preview(body.body, body.event) } };
  }
}
