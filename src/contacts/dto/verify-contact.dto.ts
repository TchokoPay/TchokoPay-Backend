import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyContactDto {
  @ApiProperty({ description: 'Contact ID to verify' })
  @IsString()
  contactId!: string;

  @ApiProperty({ description: 'OTP code sent to the contact' })
  @IsString()
  code!: string;
}
