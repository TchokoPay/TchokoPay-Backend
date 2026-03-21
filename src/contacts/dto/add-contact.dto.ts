/* eslint-disable prettier/prettier */
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export enum ContactType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
}

export class AddContactDto {
  @ApiProperty({ enum: ContactType })
    @IsEnum(ContactType)
    type!: ContactType;

  @ApiProperty({ example: 'user@gmail.com or 677000000' })
    @IsString()
    value!: string;
}