/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { PAYMENT_LINK_DURATIONS } from './create-payment-link.dto.js';

export const EVENT_TYPES = [
  'CONFERENCE',
  'SEMINAR',
  'WORKSHOP',
  'CONCERT',
  'MEETUP',
  'WEBINAR',
  'OTHER',
] as const;

export class CreateEventDto {
  @ApiProperty({ example: 'CONFERENCE', enum: EVENT_TYPES })
  @Transform(({ value }) => value?.toUpperCase?.().trim?.() ?? value)
  @IsIn(EVENT_TYPES as unknown as string[])
  eventType!: string;

  @ApiProperty({ example: 'Bitcoin Kids 2025', description: 'Event title' })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 120)
  title!: string;

  @ApiProperty({ example: 'Registration', description: 'What you collect (e.g. Registration, Ticket)' })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 80)
  collectLabel!: string;

  @ApiPropertyOptional({ example: 'A hands-on Bitcoin conference for young builders.' })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiProperty({ example: 'USD', description: 'Base currency the amount is denominated in' })
  @Transform(({ value }) => value?.toUpperCase?.().trim?.() ?? value)
  @IsString()
  @Length(2, 10)
  baseCurrency!: string;

  @ApiProperty({ example: 50, description: 'Fixed amount in the base currency' })
  @IsNumber()
  @Min(0.0001)
  baseAmount!: number;

  @ApiProperty({ example: 30, enum: PAYMENT_LINK_DURATIONS, description: 'Registration window in days' })
  @IsIn(PAYMENT_LINK_DURATIONS as unknown as number[])
  durationDays!: number;

  @ApiPropertyOptional({ description: 'Uploaded cover banner URL' })
  @IsOptional()
  @IsString()
  coverImageUrl?: string;

  @ApiPropertyOptional({ description: 'Uploaded logo URL' })
  @IsOptional()
  @IsString()
  logoUrl?: string;
}
