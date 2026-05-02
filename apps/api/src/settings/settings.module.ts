import { Module, forwardRef } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { CrawlerModule } from '../crawler/crawler.module';
import { AlertsModule } from '../alerts/alerts.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [
    forwardRef(() => CrawlerModule),
    forwardRef(() => AlertsModule),
    forwardRef(() => LogsModule),
  ],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
