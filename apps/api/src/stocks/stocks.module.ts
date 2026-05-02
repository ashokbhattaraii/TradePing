import { Module } from '@nestjs/common';
import { StocksController } from './stocks.controller';
import { CrawlerModule } from '../crawler/crawler.module';

@Module({ imports: [CrawlerModule], controllers: [StocksController] })
export class StocksModule {}
