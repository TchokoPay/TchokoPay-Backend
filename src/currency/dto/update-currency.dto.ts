import { PartialType } from '@nestjs/swagger';
import { CreateCurrencyDto } from './create-currency.dto.js';

export class UpdateCurrencyDto extends PartialType(CreateCurrencyDto) {}