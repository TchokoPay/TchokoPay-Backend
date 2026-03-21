/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: '670000321',
    description: 'Email or phone number',
  })
  @IsString()
  identifier!: string;

  @ApiProperty({
    example: 'password123',
    description: 'User password',
  })
  @IsString()
  password!: string;
}