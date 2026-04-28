/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsString,
  IsOptional,
  IsEmail,
  MinLength,
  MaxLength,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SignupDto {
  // ── Identity ─────────────────────────────────────────────────────────────

  @ApiProperty({ example: 'Brian' })
  @IsString()
  @IsNotEmpty({ message: 'First name is required' })
  @MaxLength(50, { message: 'First name is too long' })
  firstName!: string;

  @ApiProperty({ example: 'Tchoko' })
  @IsString()
  @IsNotEmpty({ message: 'Last name is required' })
  @MaxLength(50, { message: 'Last name is too long' })
  lastName!: string;

  // ── Contact — exactly ONE must be provided ────────────────────────────────

  @ApiProperty({
    example: 'brian@tchokopay.com',
    required: false,
    description: 'Valid email address. Cannot be a phone number or plain text.',
  })
  @IsOptional()
  @IsEmail({}, {
    message: 'Please enter a valid email address (e.g. you@example.com)',
  })
  @MaxLength(254, { message: 'Email address is too long' })
  email?: string;

  @ApiProperty({
    example: '+237670000000',
    required: false,
    description:
      'Phone in E.164 international format — starts with +, digits only, no spaces or letters.',
  })
  @IsOptional()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message:
      'Phone must be in international format (e.g. +237670000000). Digits only — no letters or spaces.',
  })
  phone?: string;

  // ── Credentials ───────────────────────────────────────────────────────────

  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @MaxLength(128, { message: 'Password is too long' })
  password!: string;
}
