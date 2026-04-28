/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    example: 'brian@tchokopay.com',
    description:
      'Registered email address OR phone number in E.164 format (+237670000000)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Email or phone number is required' })
  @MaxLength(254, { message: 'Identifier is too long' })
  identifier!: string;

  @ApiProperty({
    example: 'Str0ngPass!',
    description: 'Account password',
  })
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters' })
  @MaxLength(128, { message: 'Password is too long' })
  password!: string;
}
