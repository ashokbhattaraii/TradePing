import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ChannelsService, type UpsertChannelDto } from './channels.service';

@Controller('notifications/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.channels.findAll(user.id) };
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.channels.findOne(id, user.id) };
  }

  @Post()
  async create(@Body() body: UpsertChannelDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.channels.create(body, user.id) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<UpsertChannelDto>, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.channels.update(id, body, user.id) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.channels.remove(id, user.id) };
  }

  @Post(':id/test')
  async test(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.channels.test(id, user.id);
    return { success: result.ok, data: result };
  }
}
