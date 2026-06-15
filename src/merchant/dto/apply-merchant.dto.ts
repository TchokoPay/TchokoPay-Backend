/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { MerchantBusinessType } from '@prisma/client';

export class ApplyMerchantDto {
  @ApiProperty({
    example: 'Tchoko Boutique',
    description: 'Name of the business',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 100)
  businessName!: string;

  @ApiProperty({
    example: 'RETAIL',
    enum: MerchantBusinessType,
    description: 'Category that best describes the business',
  })
  @Transform(({ value }) => value?.toUpperCase?.().trim?.() ?? value)
  @IsEnum(MerchantBusinessType)
  businessType!: MerchantBusinessType;

  @ApiPropertyOptional({
    example: 'We sell handmade crafts and accessories.',
    description: 'Short description of the business',
  })
  @IsOptional()
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(0, 500)
  description?: string;
}
