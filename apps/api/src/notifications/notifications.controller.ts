import { Body, Controller, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('test/:channel')
  async test(
    @Param('channel') channel: string,
    @Body()
    body: {
      slackWebhookUrl?: string;
      whatsappAccountSid?: string;
      whatsappAuthToken?: string;
      whatsappFromNumber?: string;
      whatsappPhone?: string;
    } = {},
    @CurrentUser() user: AuthUser,
  ) {
    if (channel === 'slack') {
      const result = await this.notifications.testSlack(user.id, body);
      return { success: result.ok, data: result };
    }
    if (channel === 'whatsapp') {
      const result = await this.notifications.testWhatsApp(user.id, body);
      return { success: result.ok, data: result };
    }
    return { success: false, data: { ok: false, error: `Unknown channel: ${channel}` } };
  }
}
