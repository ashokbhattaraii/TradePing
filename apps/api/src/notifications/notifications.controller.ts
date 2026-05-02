import { Controller, Param, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('test/:channel')
  async test(@Param('channel') channel: string) {
    if (channel === 'slack') {
      const result = await this.notifications.testSlack();
      return { success: result.ok, data: result };
    }
    if (channel === 'whatsapp') {
      const result = await this.notifications.testWhatsApp();
      return { success: result.ok, data: result };
    }
    return { success: false, data: { ok: false, error: `Unknown channel: ${channel}` } };
  }
}
