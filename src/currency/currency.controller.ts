import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { CurrencyService } from './currency.service.js';
import { CreateCurrencyDto } from './dto/create-currency.dto.js';
import { UpdateCurrencyDto } from './dto/update-currency.dto.js';

import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { Public } from '../auth/decorators/public.decorator.js';

@ApiTags('Currency')
@Controller('currencies')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  // ================================
  // CREATE
  // ================================
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new currency' })
  @ApiResponse({ status: 201, description: 'Currency created successfully' })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateCurrencyDto) {
    return this.currencyService.create(dto);
  }

  // ================================
  // GET ALL
  // ================================
  @Public()
  @ApiOperation({ summary: 'Get all currencies' })
  @ApiResponse({ status: 200, description: 'List of currencies' })
  @Get()
  findAll() {
    return this.currencyService.findAll();
  }

  // ================================
  // GET ONE
  // ================================
  @Public()
  @ApiOperation({ summary: 'Get currency by code' })
  @ApiResponse({ status: 200, description: 'Currency details' })
  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.currencyService.findOne(code);
  }

  // ================================
  // UPDATE
  // ================================
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a currency' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCurrencyDto) {
    return this.currencyService.update(id, dto);
  }

  // ================================
  // DEACTIVATE
  // ================================
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate a currency' })
  @UseGuards(JwtAuthGuard)
  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.currencyService.deactivate(id);
  }
}