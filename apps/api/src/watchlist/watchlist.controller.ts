import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, Matches, IsArray } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
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
  async findAll(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.findAll(user.id) };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.findOne(id, user.id) };
  }

  @Post()
  async create(@Body() dto: CreateWatchlistDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.create(dto.name, user.id) };
  }

  @Patch(':id/rename')
  async rename(@Param('id') id: string, @Body() dto: RenameWatchlistDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.rename(id, dto.name, user.id) };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.remove(id, user.id) };
  }

  @Post(':id/symbols')
  async addSymbol(@Param('id') id: string, @Body() dto: SymbolDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.addSymbol(id, dto.symbol, user.id) };
  }

  @Delete(':id/symbols/:symbol')
  async removeSymbol(@Param('id') id: string, @Param('symbol') symbol: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.removeSymbol(id, symbol, user.id) };
  }

  @Patch(':id/reorder')
  async reorder(@Param('id') id: string, @Body() dto: ReorderDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.service.reorderSymbols(id, dto.symbols, user.id) };
  }
}
