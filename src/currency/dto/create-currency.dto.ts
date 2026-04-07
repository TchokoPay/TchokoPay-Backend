import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';

export class CreateCurrencyDto {
  @ApiProperty({
    example: 'BTC',
    description: 'Unique currency code (e.g. BTC, USD, XAF)',
  })
  @IsString()
  code!: string;

  @ApiProperty({
    example: 'Bitcoin',
    description: 'Full name of the currency',
  })
  @IsString()
  name!: string;

  @ApiPropertyOptional({
    example: '₿',
    description: 'Currency symbol',
  })
  @IsOptional()
  @IsString()
  symbol?: string;

  @ApiProperty({
    example: 8,
    description: 'Number of decimal places (BTC = 8, USD = 2)',
  })
  @IsInt()
  @Min(0)
  decimals!: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Indicates if the currency is a cryptocurrency',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isCrypto?: boolean;
}