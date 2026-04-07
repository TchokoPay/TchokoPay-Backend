/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum } from 'class-validator';

import { PaymentMethodEnum, FlowEnum } from './enums.js'; // adjust path

export class GetPricingDto {
  @ApiProperty({ example: 'BTC' })
  @IsString()
  baseCurrency!: string;

  @ApiProperty({ example: 'XAF' })
  @IsString()
  targetCurrency!: string;

  // 🔥 PAYER METHOD
  @ApiPropertyOptional({
    enum: PaymentMethodEnum,
    example: 'MOMO',
  })
  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  paymentMethod?: PaymentMethodEnum;

  // 🔥 RECEIVER METHOD
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
}