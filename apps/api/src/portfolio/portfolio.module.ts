import { Module, forwardRef } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';
import { CrawlerModule } from '../crawler/crawler.module';
import { SettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LogsModule } from '../logs/logs.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [
    forwardRef(() => CrawlerModule),
    forwardRef(() => SettingsModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => LogsModule),
    forwardRef(() => AlertsModule),
  ],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}
