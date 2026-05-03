import { Module, forwardRef } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { CrawlerModule } from '../crawler/crawler.module';

@Module({
  imports: [forwardRef(() => NotificationsModule), forwardRef(() => SettingsModule), forwardRef(() => CrawlerModule)],
  controllers: [AlertsController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
