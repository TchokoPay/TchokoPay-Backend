/* eslint-disable prettier/prettier */
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Logger,
  Query,
  UseGuards,
} from '@nestjs/common';

import { PricingService } from './pricing.service.js';
import { CreatePricingDto } from './dto/create-pricing.dto.js';
import { UpdatePricingDto } from './dto/update-fee-config.dto.js';

import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

// 🔐 JWT GUARD
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';

@ApiTags('Pricing')
@ApiBearerAuth()
@Controller('pricing')
@UseGuards(JwtAuthGuard) // 🔥 Protect ALL routes
export class PricingController {
  private readonly logger = new Logger(PricingController.name);

  constructor(private readonly service: PricingService) {}

  // ============================
  // CREATE PRICING
  // ============================
  @Post()
  @ApiOperation({ summary: 'Create pricing config' })
  create(@Body() dto: CreatePricingDto) {
    return this.service.create(dto);
  }

  // ============================
  // GET ALL
  // ============================
  @Get()
  @ApiOperation({ summary: 'Get all pricing configs' })
  findAll() {
    return this.service.findAll();
  }

  // ============================
  // GET ONE
  // ============================
  @Get(':id')
  @ApiOperation({ summary: 'Get pricing by ID' })
  @ApiParam({ name: 'id' })
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // ============================
  // UPDATE
  // ============================
  @Patch(':id')
  @ApiOperation({ summary: 'Update pricing' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePricingDto,
  ) {
    return this.service.update(id, dto);
  }

  // ============================
  // DELETE
  // ============================
  @Delete(':id')
  @ApiOperation({ summary: 'Delete pricing' })
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // ============================
  // TOGGLE ACTIVE
  // ============================
  @Patch(':id/toggle')
  @ApiOperation({ summary: 'Toggle pricing active state' })
  toggle(@Param('id') id: string) {
    return this.service.toggle(id);
  }

  // ============================
  // TEST PRICING ENGINE
  // ============================
  @Get('calculate/test')
  @ApiOperation({ summary: 'Test pricing engine' })
  calculate(@Query() query: any) {
    return this.service.getPricing(query);
  }
}