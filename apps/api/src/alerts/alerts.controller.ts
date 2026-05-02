import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { CreateAlertDto } from './dto/create-alert.dto';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  async findAll() {
    return { success: true, data: await this.alertsService.findAll() };
  }

  @Post()
  async create(@Body() dto: CreateAlertDto) {
    const alert = await this.alertsService.create(dto);
    return { success: true, data: alert, message: 'Alert created' };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const result = await this.alertsService.remove(id);
    return { success: true, data: result, message: 'Alert removed' };
  }
}
