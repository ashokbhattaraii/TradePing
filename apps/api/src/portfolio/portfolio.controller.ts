import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { PortfolioService } from './portfolio.service';

class SaveHoldingDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,12}$/)
  symbol!: string;

  @IsNumber()
  @Min(0.000001)
  quantity!: number;

  @IsNumber()
  @Min(0.000001)
  averageCost!: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

class UpdateHoldingDto {
  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  quantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.000001)
  averageCost?: number;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

class AnalyzeDto {
  @IsOptional()
  notify?: boolean;
}

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioService) {}

  @Get('holdings')
  async holdings(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.listHoldings(user.id) };
  }

  @Post('holdings')
  async saveHolding(@Body() body: SaveHoldingDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.upsertHolding(user.id, body) };
  }

  @Patch('holdings/:id')
  async updateHolding(@Param('id') id: string, @Body() body: UpdateHoldingDto, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.updateHolding(id, user.id, body) };
  }

  @Delete('holdings/:id')
  async removeHolding(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.removeHolding(id, user.id) };
  }

  @Get('analysis/latest')
  async latest(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.latestAnalysis(user.id) };
  }

  @Get('analysis')
  async history(@CurrentUser() user: AuthUser) {
    return { success: true, data: await this.portfolio.analysisHistory(user.id) };
  }

  @Post('analyze')
  async analyze(@Body() body: AnalyzeDto, @CurrentUser() user: AuthUser) {
    return {
      success: true,
      data: await this.portfolio.analyze(user.id, { reason: 'manual', notify: Boolean(body.notify) }),
    };
  }
}
