import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { StocksModule } from './stocks/stocks.module';
import { AlertsModule } from './alerts/alerts.module';
import { CrawlerModule } from './crawler/crawler.module';
import { LogsModule } from './logs/logs.module';
import { SettingsModule } from './settings/settings.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { NotificationsModule } from './notifications/notifications.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    LogsModule,
    HealthModule,
    StocksModule,
    AlertsModule,
    CrawlerModule,
    SettingsModule,
    WatchlistModule,
    NotificationsModule,
    DatabaseModule,
    AdminModule,
  ],
})
export class AppModule {}
