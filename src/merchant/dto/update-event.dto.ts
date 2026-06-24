/* eslint-disable prettier/prettier */
import { PartialType } from '@nestjs/swagger';
import { CreateEventDto } from './create-event.dto.js';

/** All event fields, every one optional — a merchant can edit any subset. */
export class UpdateEventDto extends PartialType(CreateEventDto) {}
