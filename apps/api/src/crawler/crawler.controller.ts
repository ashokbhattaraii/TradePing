import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Sse,
  MessageEvent,
  BadRequestException,
} from '@nestjs/common';
import { Observable, map, startWith } from 'rxjs';
import { CrawlerService } from './crawler.service';

@Controller('crawler')
export class CrawlerController {
  constructor(private readonly crawler: CrawlerService) {}

  @Get('status')
  status() {
    return { success: true, data: this.crawler.getStatus() };
  }

  @Get('prices')
  prices() {
    return { success: true, data: this.crawler.getLatestPrices() };
  }

  @Sse('prices/stream')
  stream(): Observable<MessageEvent> {
    return this.crawler.subscribePrices().pipe(
      startWith(this.crawler.getLatestPrices()),
      map((data) => ({ data })),
    );
  }

  @Get('prices/:symbol/history')
  async history(
    @Param('symbol') symbol: string,
    @Query('range') range = '1d',
  ) {
    if (range !== '1d' && range !== '5d' && range !== '1mo') {
      throw new BadRequestException('range must be 1d, 5d, or 1mo');
    }
    const data = await this.crawler.getHistory(symbol, range);
    return { success: true, data };
  }

  @Post('prices/refresh')
  async refreshPrices() {
    const data = await this.crawler.refreshPrices();
    return { success: true, data, message: 'Prices refreshed' };
  }

  @Get('debug/state')
  debugState() {
    return { success: true, data: this.crawler.getDebugState() };
  }

  @Post('debug/clear-cache')
  clearCache() {
    this.crawler.clearCache();
    return { success: true, message: 'Crawler cache cleared' };
  }

  @Post('check')
  async check() {
    const data = await this.crawler.runManualCheck();
    return { success: true, data, message: 'Manual check completed' };
  }
}
