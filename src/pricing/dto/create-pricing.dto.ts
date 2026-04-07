/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsEnum,
} from 'class-validator';

import { PaymentMethodEnum, FlowEnum } from './enums.js'; // adjust path

export class CreatePricingDto {
  // ============================
  // MATCHING CONDITIONS
  // ============================

  @ApiPropertyOptional({ example: 'BTC' })
  @IsOptional()
  @IsString()
  baseCurrencyCode?: string;

  @ApiPropertyOptional({ example: 'XAF' })
  @IsOptional()
  @IsString()
  targetCurrencyCode?: string;

  // 🔥 PAYER METHOD
  @ApiPropertyOptional({
    enum: PaymentMethodEnum,
    example: 'MOMO',
  })
  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  paymentMethod?: PaymentMethodEnum;

  // 🔥 RECEIVER METHOD (NEW)
  @ApiPropertyOptional({
    enum: PaymentMethodEnum,
    example: 'MOMO',
  })
  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  payoutMethod?: PaymentMethodEnum;

  // 🔥 FLOW
  @ApiPropertyOptional({
    enum: FlowEnum,
    example: 'HANDLE',
  })
  @IsOptional()
  @IsEnum(FlowEnum)
  flow?: FlowEnum;

  // ============================
  // PRICING
  // ============================

  @ApiProperty({
    example: 1.5,
    description: 'Fee percentage charged',
  })
  @IsNumber()
  feePercent!: number;

  @ApiProperty({
    example: 1.0,
    description: 'Spread percentage applied to rate',
  })
  @IsNumber()
  spreadPercent!: number;

  // ============================
  // CONTROL
  // ============================

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber()
  priority?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}