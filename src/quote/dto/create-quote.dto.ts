/* eslint-disable prettier/prettier */
import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';

import {
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
} from 'class-validator';

// 🔥 ENUMS (MATCH YOUR SYSTEM)
export enum PaymentMethodEnum {
  MOMO = 'MOMO',
  ORANGE = 'ORANGE',
  BTC = 'BTC',
  LIGHTNING = 'LIGHTNING',
  CARD = 'CARD',
  BANK = 'BANK',
}

export enum FlowEnum {
  DIRECT = 'DIRECT',
  QR = 'QR',
  REQUEST = 'REQUEST',
}

export class CreateQuoteDto {
  // ============================
  // BASE CURRENCY (USER PAYS)
  // ============================
  @ApiProperty({
    example: 'BTC',
    description: 'Currency the payer is sending',
  })
  @IsString()
  baseCurrency!: string;

  // ============================
  // TARGET CURRENCY (USER RECEIVES)
  // ============================
  @ApiProperty({
    example: 'XAF',
    description: 'Currency the recipient receives',
  })
  @IsString()
  targetCurrency!: string;

  // ============================
  // AMOUNT TYPE (PAY vs RECEIVE) 🔥 NEW
  // ============================
  @ApiPropertyOptional({
    example: 'PAY', // or 'RECEIVE'
    description: 'Whether amount is what user pays or receives',
  })
  @IsOptional()
  @IsString()
  amountType?: string;

  // ============================
  // AMOUNT (BASE)
  // ============================
  @ApiProperty({
    example: 0.001,
    description: 'Amount in base currency',
  })
  @IsNumber()
  @Min(0.00000001)
  amount!: number;

  // ============================
  // PAYMENT METHOD (PAYER SIDE)
  // ============================
  @ApiPropertyOptional({
    enum: PaymentMethodEnum,
    example: 'MOMO',
    description: 'How the payer will pay',
  })
  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  paymentMethod?: PaymentMethodEnum;

  // ============================
  // PAYOUT METHOD (RECEIVER SIDE) 🔥 NEW
  // ============================
  @ApiPropertyOptional({
    enum: PaymentMethodEnum,
    example: 'MOMO',
    description: 'How the recipient will receive money',
  })
  @IsOptional()
  @IsEnum(PaymentMethodEnum)
  payoutMethod?: PaymentMethodEnum;

  // ============================
  // FLOW TYPE
  // ============================
  @ApiPropertyOptional({
    enum: FlowEnum,
    example: 'HANDLE',
    description: 'Payment flow type',
  })
  @IsOptional()
  @IsEnum(FlowEnum)
  flow?: FlowEnum;

  // ============================
  // PRICING OVERRIDES (merchant events/links)
  // ============================
  /**
   * Look up the fee/spread by THIS currency instead of `baseCurrency`. Used for
   * merchant events/links so pricing is keyed by the merchant's base currency
   * (e.g. USD) while the FX conversion still uses the payer's actual currency.
   */
  @IsOptional()
  @IsString()
  pricingBaseCurrency?: string;

  /** Skip platform fee/spread entirely (0/0). Used to settle merchants at a clean rate. */
  @IsOptional()
  cleanRate?: boolean;
}
