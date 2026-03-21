/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDto {
  @ApiProperty({
    example: '670000321',
  })
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: '123456',
  })
  @IsString()
  code!: string;
}