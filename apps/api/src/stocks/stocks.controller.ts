import { Controller, Get } from '@nestjs/common';
import { STOCK_SYMBOLS } from '@tradeping/types';
import { CrawlerService } from '../crawler/crawler.service';

@Controller('stocks')
export class StocksController {
  constructor(private readonly crawler: CrawlerService) {}

  @Get()
  findAll() {
    const liveSymbols = this.crawler.getAvailableSymbols();
    return { success: true, data: liveSymbols.length > 0 ? liveSymbols : STOCK_SYMBOLS };
  }
}
