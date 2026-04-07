/* eslint-disable prettier/prettier */
import { PartialType } from '@nestjs/swagger';
import { CreatePricingDto } from './create-pricing.dto.js';

export class UpdatePricingDto extends PartialType(CreatePricingDto) {}