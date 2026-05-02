import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async findAll(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.alertsService.findAll(user.id) };
  }

  @Post()
  async create(@Body() dto: CreateAlertDto, @CurrentUser() user: AuthUser) {
    const alert = await this.alertsService.create(dto, user.id);
    return { success: true, data: alert, message: 'Alert created' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const result = await this.alertsService.remove(id, user.id);
    return { success: true, data: result, message: 'Alert removed' };
  }
}
