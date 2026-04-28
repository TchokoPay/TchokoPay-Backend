/* eslint-disable @typescript-eslint/no-unsafe-call */
import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyDto {
  @ApiProperty({
    example: '+237670000000',
    description: 'The email or phone used at sign-up',
  })
  @IsString()
  @IsNotEmpty({ message: 'Identifier is required' })
  @MaxLength(254)
  identifier!: string;

  @ApiProperty({
    example: '482916',
    description: 'Exactly 6 digits sent via OTP',
  })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be exactly 6 digits' })
  code!: string;
}
