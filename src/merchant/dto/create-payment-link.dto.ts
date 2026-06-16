/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { Transform } from 'class-transformer';

/** Allowed link durations in days (null = no expiry handled separately). */
export const PAYMENT_LINK_DURATIONS = [7, 30, 90, 180] as const;

export class CreatePaymentLinkDto {
  @ApiProperty({ example: 'Rent Collection', description: 'What the link collects for' })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 120)
  reason!: string;

  @ApiPropertyOptional({ example: 'Monthly rent for April', description: 'Optional longer note' })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiProperty({ example: 'USD', description: 'Base currency code the amount is denominated in' })
  @Transform(({ value }) => value?.toUpperCase?.().trim?.() ?? value)
  @IsString()
  @Length(2, 10)
  baseCurrency!: string;

  @ApiProperty({ example: 21, description: 'Fixed amount in the base currency' })
  @IsNumber()
  @Min(0.0001)
  baseAmount!: number;

  @ApiProperty({ example: 30, enum: PAYMENT_LINK_DURATIONS, description: 'Link lifetime in days' })
  @IsIn(PAYMENT_LINK_DURATIONS as unknown as number[])
  durationDays!: number;
}
