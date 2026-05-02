import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, Matches, IsArray } from 'class-validator';
import { WatchlistService } from './watchlist.service';

class CreateWatchlistDto {
  @IsString()
  @MaxLength(60)
  name!: string;
}

class RenameWatchlistDto {
  @IsString()
  @MaxLength(60)
  name!: string;
}

class SymbolDto {
  @IsString()
  @Matches(/^[A-Z0-9]{1,12}$/)
  symbol!: string;
}

class ReorderDto {
  @IsArray()
  @IsString({ each: true })
  symbols!: string[];
}

@Controller('watchlists')
export class WatchlistController {
  constructor(private readonly service: WatchlistService) {}

  @Get()
  async findAll() {
    return { success: true, data: await this.service.findAll() };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return { success: true, data: await this.service.findOne(id) };
  }

  @Post()
  async create(@Body() dto: CreateWatchlistDto) {
    return { success: true, data: await this.service.create(dto.name) };
  }

  @Patch(':id/rename')
  async rename(@Param('id') id: string, @Body() dto: RenameWatchlistDto) {
    return { success: true, data: await this.service.rename(id, dto.name) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.service.remove(id) };
  }

  @Post(':id/symbols')
  async addSymbol(@Param('id') id: string, @Body() dto: SymbolDto) {
    return { success: true, data: await this.service.addSymbol(id, dto.symbol) };
  }

  @Delete(':id/symbols/:symbol')
  async removeSymbol(@Param('id') id: string, @Param('symbol') symbol: string) {
    return { success: true, data: await this.service.removeSymbol(id, symbol) };
  }

  @Patch(':id/reorder')
  async reorder(@Param('id') id: string, @Body() dto: ReorderDto) {
    return { success: true, data: await this.service.reorderSymbols(id, dto.symbols) };
  }
}
