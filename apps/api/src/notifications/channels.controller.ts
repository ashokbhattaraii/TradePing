import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ChannelsService, type UpsertChannelDto } from './channels.service';

@Controller('notifications/channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  async list() {
    return { success: true, data: await this.channels.findAll() };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return { success: true, data: await this.channels.findOne(id) };
  }

  @Post()
  async create(@Body() body: UpsertChannelDto) {
    return { success: true, data: await this.channels.create(body) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<UpsertChannelDto>) {
    return { success: true, data: await this.channels.update(id, body) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.channels.remove(id) };
  }

  @Post(':id/test')
  async test(@Param('id') id: string) {
    const result = await this.channels.test(id);
    return { success: result.ok, data: result };
  }
}
