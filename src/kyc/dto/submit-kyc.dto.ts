/* eslint-disable prettier/prettier */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  Length,
  IsEnum,
} from 'class-validator';
import { Transform } from 'class-transformer';

// ✅ ENUM (BEST PRACTICE)
export enum KycIdType {
  NATIONAL_ID = 'NATIONAL_ID',
  PASSPORT = 'PASSPORT',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
}

export class SubmitKycDto {
  @ApiProperty({
    example: 'John',
    description: 'User first name',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 50)
  firstName!: string;

  @ApiProperty({
    example: 'Doe',
    description: 'User last name',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(2, 50)
  lastName!: string;

  @ApiPropertyOptional({
    example: '2000-01-01',
    description: 'Date of birth (ISO format)',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return value;

    const date = new Date(value);
    if (isNaN(date.getTime())) return value; // let validator fail

    return date.toISOString(); // ensures ISO format
  })
  @IsDateString()
  dateOfBirth?: string;

  @ApiProperty({
    example: 'NATIONAL_ID',
    enum: KycIdType,
    description: 'Type of identification document',
  })
  @Transform(({ value }) => value?.toUpperCase().trim())
  @IsEnum(KycIdType)
  idType!: KycIdType;

  @ApiProperty({
    example: '123456789',
    description: 'Government-issued ID number',
  })
  @Transform(({ value }) => value?.trim())
  @IsString()
  @Length(5, 50)
  idNumber!: string;
}