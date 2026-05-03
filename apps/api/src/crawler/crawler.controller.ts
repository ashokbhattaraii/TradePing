import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Sse,
  MessageEvent,
  BadRequestException,
} from '@nestjs/common';
import { Observable, map, startWith } from 'rxjs';
import { CrawlerService } from './crawler.service';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';

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

  @Public()
  @Get('prices/preview')
  pricesPreview(@Query('limit') limit = '10') {
    const n = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 25);
    const data = this.crawler
      .getLatestPrices()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, n)
      .map(({ symbol, name, price, change, changePct, sector, source, timestamp }) => ({
        symbol,
        name,
        price,
        change,
        changePct,
        sector,
        source,
        timestamp,
      }));
    return { success: true, data };
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

  @Post('predict')
  async predict(
    @Body() body: { symbols?: string[] | string; sourceIds?: string[]; customSources?: { label?: string; url: string }[] },
  ) {
    const raw = Array.isArray(body?.symbols)
      ? body.symbols
      : String(body?.symbols ?? '')
          .split(/[\s,]+/)
          .filter(Boolean);
    const symbols = raw.map((symbol) => String(symbol).trim()).filter(Boolean);
    if (symbols.length === 0) {
      throw new BadRequestException('At least one stock symbol is required');
    }
    const data = await this.crawler.analyzeStocks(symbols, 'batch', body?.sourceIds, body?.customSources);
    return { success: true, data, message: 'Crawler prediction completed' };
  }

  @Post('predict/single')
  async predictSingle(
    @Body() body: { symbol?: string; sourceIds?: string[]; customSources?: { label?: string; url: string }[] },
  ) {
    const symbol = String(body?.symbol ?? '').trim();
    if (!symbol) {
      throw new BadRequestException('A stock symbol is required');
    }
    const data = await this.crawler.analyzeSingleStock(symbol, body?.sourceIds, body?.customSources);
    return { success: true, data, message: 'Single-stock crawl completed' };
  }

  @Post('compare')
  async compare(
    @Body() body: { symbols?: string[] | string; sourceIds?: string[]; customSources?: { label?: string; url: string }[] },
  ) {
    const raw = Array.isArray(body?.symbols)
      ? body.symbols
      : String(body?.symbols ?? '')
          .split(/[\s,]+/)
          .filter(Boolean);
    const symbols = raw.map((symbol) => String(symbol).trim()).filter(Boolean);
    if (symbols.length < 2) {
      throw new BadRequestException('At least two stock symbols are required for comparison');
    }
    const data = await this.crawler.compareStocks(symbols, body?.sourceIds, body?.customSources);
    return { success: true, data, message: 'Comparison crawl completed' };
  }

  @RequirePermissions('crawler.control')
  @Post('prices/refresh')
  async refreshPrices() {
    const data = await this.crawler.refreshPrices();
    return { success: true, data, message: 'Prices refreshed' };
  }

  @Get('debug/state')
  debugState() {
    return { success: true, data: this.crawler.getDebugState() };
  }

  @RequirePermissions('crawler.control')
  @Post('debug/clear-cache')
  clearCache() {
    this.crawler.clearCache();
    return { success: true, message: 'Crawler cache cleared' };
  }

  @RequirePermissions('crawler.control')
  @Post('check')
  async check() {
    const data = await this.crawler.runManualCheck();
    return { success: true, data, message: 'Manual check completed' };
  }
}
