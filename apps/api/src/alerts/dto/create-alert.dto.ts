import { IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ALERT_CONDITIONS, ALERT_PRIORITIES } from '@tradeping/types';
import type { StockSymbol, AlertCondition, AlertPriority } from '@tradeping/types';

export class CreateAlertDto {
  @IsString()
  @Matches(/^[A-Z0-9]{1,12}$/)
  symbol!: StockSymbol;

  @IsNumber()
  @Min(0)
  targetPrice!: number;

  @IsIn(ALERT_CONDITIONS)
  condition!: AlertCondition;

  @IsOptional()
  @IsIn(ALERT_PRIORITIES)
  priority?: AlertPriority;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
