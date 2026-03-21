/* eslint-disable prettier/prettier */
import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty()
    @IsString()
    value!: string;

  @ApiProperty()
    @IsString()
    code!: string;
}