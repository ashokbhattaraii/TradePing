import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SettingsService, type SystemSettings } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.settings.getForUser(user.id) };
  }

  @Patch()
  async update(
    @Body() body: Partial<Omit<SystemSettings, 'port'>>,
    @CurrentUser() user: AuthUser,
  ) {
    const updated = await this.settings.updateForUser(user.id, body);
    return { success: true, data: updated };
  }
}
