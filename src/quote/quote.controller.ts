import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';

import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';

import { QuoteService } from './quote.service.js';
import { CreateQuoteDto } from './dto/create-quote.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { Public } from '../auth/decorators/public.decorator.js';

@ApiTags('Quote')
@Controller('quotes')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  // ============================
  // CREATE QUOTE
  // ============================
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a quote (locks price)' })
  @ApiResponse({ status: 201 })
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateQuoteDto) {
    return this.quoteService.create(dto);
  }

  @Public()
  @ApiOperation({ summary: 'Preview a quote without saving it' })
  @ApiResponse({ status: 201 })
  @Post('preview')
  preview(@Body() dto: CreateQuoteDto) {
    return this.quoteService.preview(dto);
  }

  // ============================
  // GET QUOTE
  // ============================
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get quote by ID' })
  @UseGuards(JwtAuthGuard)
  @Get(':id')
  get(@Param('id') id: string) {
    return this.quoteService.getQuote(id);
  }
}
