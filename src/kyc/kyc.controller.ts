/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
  Req,
  Body,
  BadRequestException,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';

import { KycService } from './kyc.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { SubmitKycDto, KycIdType } from './dto/submit-kyc.dto.js';

// ✅ MATCHES JWT STRATEGY
interface AuthRequest extends Request {
  user: {
    userId: string;
    email: string;
  };
}

@ApiTags('KYC')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  // =========================================
  // 📥 SUBMIT KYC
  // =========================================
  @Post('submit')
  @ApiOperation({ summary: 'Submit KYC documents (ID + Selfie)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'document', maxCount: 1 },
      { name: 'documentBack', maxCount: 1 },
      { name: 'selfie', maxCount: 1 },
    ]),
  )
  @ApiBody({
    description: 'Submit KYC details + upload files',
    schema: {
      type: 'object',
      required: [
        'firstName',
        'lastName',
        'idType',
        'idNumber',
        'document',
        'selfie',
      ],
      properties: {
        firstName: { type: 'string', example: 'John' },
        lastName: { type: 'string', example: 'Doe' },
        dateOfBirth: {
          type: 'string',
          example: '2000-01-01',
          description: 'ISO date format',
        },
        idType: {
          type: 'string',
          enum: Object.values(KycIdType),
          example: 'NATIONAL_ID',
        },
        idNumber: { type: 'string', example: '123456789' },
        document: { type: 'string', format: 'binary' },
        documentBack: { type: 'string', format: 'binary' },
        selfie: { type: 'string', format: 'binary' },
      },
    },
  })
  async submitKyc(
    @Req() req: AuthRequest,
    @UploadedFiles()
    files: {
      document?: Express.Multer.File[];
      documentBack?: Express.Multer.File[];
      selfie?: Express.Multer.File[];
    },
    @Body() dto: SubmitKycDto,
  ) {
    console.log('================ KYC SUBMIT START ================');
    console.log('[KYC CONTROLLER] Auth user:', req.user);
    console.log('[KYC CONTROLLER] DTO (transformed):', dto);

    const userId = req.user?.userId;

    if (!userId) {
      console.error('[KYC CONTROLLER] Unauthorized - no userId');
      throw new BadRequestException('Unauthorized');
    }

    if (!files?.document?.[0] || !files?.selfie?.[0]) {
      console.error('[KYC CONTROLLER] Missing required files');
      throw new BadRequestException('Document and selfie are required');
    }

    console.log('[KYC CONTROLLER] Files received:', {
      document: !!files.document?.[0],
      documentBack: !!files.documentBack?.[0],
      selfie: !!files.selfie?.[0],
    });

    const result = await this.kycService.submitKyc(userId, dto, {
      document: files.document[0],
      documentBack: files.documentBack?.[0],
      selfie: files.selfie[0],
    });

    console.log('================ KYC SUBMIT END =================');

    return result;
  }

  // =========================================
  // 🔍 GET MY KYC
  // =========================================
  @Get('me')
  @ApiOperation({ summary: 'Get current user KYC' })
  async getMyKyc(@Req() req: AuthRequest) {
    console.log('[KYC CONTROLLER] Get my KYC');

    const userId = req.user?.userId;

    if (!userId) {
      console.error('[KYC CONTROLLER] Unauthorized - no userId');
      throw new BadRequestException('Unauthorized');
    }

    return this.kycService.getMyKyc(userId);
  }

  // =========================================
  // 🔍 GET ALL KYC
  // =========================================
  @Get('all')
  @ApiOperation({ summary: 'Get all KYC records (Admin)' })
  async getAllKyc() {
    console.log('[KYC CONTROLLER] Get all KYC');
    return this.kycService.getAllKyc();
  }

  // =========================================
  // 🔍 GET BY ID
  // =========================================
  @Get(':id')
  @ApiOperation({ summary: 'Get KYC by ID' })
  async getKycById(@Param('id') id: string) {
    console.log('[KYC CONTROLLER] Get KYC by ID:', id);
    return this.kycService.getKycById(id);
  }

  // =========================================
  // ✅ APPROVE
  // =========================================
  @Patch(':id/approve')
  @ApiOperation({ summary: 'Approve KYC (Admin)' })
  async approveKyc(@Param('id') id: string, @Req() req: AuthRequest) {
    console.log('[KYC CONTROLLER] Approve KYC:', id);

    const adminId = req.user?.userId;

    if (!adminId) {
      console.error('[KYC CONTROLLER] Unauthorized - no adminId');
      throw new BadRequestException('Unauthorized');
    }

    return this.kycService.approveKyc(id, adminId);
  }

  // =========================================
  // ❌ REJECT
  // =========================================
  @Patch(':id/reject')
  @ApiOperation({ summary: 'Reject KYC (Admin)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['reason'],
      properties: {
        reason: {
          type: 'string',
          example: 'Document is blurry',
        },
      },
    },
  })
  async rejectKyc(
    @Param('id') id: string,
    @Req() req: AuthRequest,
    @Body('reason') reason: string,
  ) {
    console.log('[KYC CONTROLLER] Reject KYC:', id);

    const adminId = req.user?.userId;

    if (!adminId) {
      console.error('[KYC CONTROLLER] Unauthorized - no adminId');
      throw new BadRequestException('Unauthorized');
    }

    if (!reason) {
      console.error('[KYC CONTROLLER] Missing rejection reason');
      throw new BadRequestException('Rejection reason is required');
    }

    return this.kycService.rejectKyc(id, adminId, reason);
  }
}