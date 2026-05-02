import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SettingsService, type SystemSettings } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return { success: true, data: this.settings.get() };
  }

  @Patch()
  async update(@Body() body: Partial<Omit<SystemSettings, 'port'>>) {
    const updated = await this.settings.update(body);
    return { success: true, data: updated };
  }
}
