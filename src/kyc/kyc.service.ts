/* eslint-disable prettier/prettier */
import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { CloudinaryService } from '../config/cloudinary.service.js';
import { SubmitKycDto } from './dto/submit-kyc.dto.js';

type KycFiles = {
  document?: Express.Multer.File;
  documentBack?: Express.Multer.File;
  selfie?: Express.Multer.File;
};

@Injectable()
export class KycService {
  constructor(
    private prisma: PrismaService,
    private cloudinary: CloudinaryService,
  ) {}

  // =========================================
  // 📥 SUBMIT KYC
  // =========================================
  async submitKyc(userId: string, dto: SubmitKycDto, files: KycFiles) {
    console.log('[KYC SERVICE] Submit started for user:', userId);

    const { firstName, lastName, idType, idNumber, dateOfBirth } = dto;

    if (!firstName || !lastName || !idType || !idNumber) {
      console.error('[KYC SERVICE] Missing fields');
      throw new BadRequestException('Missing required fields');
    }

    const { document, documentBack, selfie } = files;

    if (!document || !selfie) {
      console.error('[KYC SERVICE] Missing files');
      throw new BadRequestException('Document and selfie required');
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    [document, documentBack, selfie]
      .filter(Boolean)
      .forEach((file) => {
        if (file && !allowedTypes.includes(file.mimetype)) {
          console.error('[KYC SERVICE] Invalid file type:', file.mimetype);
          throw new BadRequestException('Invalid file type');
        }
      });

    try {
      console.log('[KYC SERVICE] Uploading to Cloudinary...');

      const [doc, back, self] = await Promise.all([
        this.cloudinary.uploadImage(document, 'kyc/documents'),
        documentBack
          ? this.cloudinary.uploadImage(documentBack, 'kyc/documents')
          : null,
        this.cloudinary.uploadImage(selfie, 'kyc/selfie'),
      ]);

      console.log('[KYC SERVICE] Upload complete');

      const existing = await this.prisma.kyc.findUnique({
        where: { userId },
      });

      if (existing?.status === 'VERIFIED') {
        console.warn('[KYC SERVICE] Already verified');
        throw new BadRequestException('KYC already verified');
      }

      const kyc = await this.prisma.kyc.upsert({
        where: { userId },
        update: {
          firstName,
          lastName,
          idType,
          idNumber,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          documentUrl: doc.secure_url,
          documentBackUrl: back?.secure_url || null,
          selfieUrl: self.secure_url,
          status: 'PENDING',
          submittedAt: new Date(),
          reviewedAt: null,
          rejectionReason: null,
        },
        create: {
          userId,
          firstName,
          lastName,
          idType,
          idNumber,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          documentUrl: doc.secure_url,
          documentBackUrl: back?.secure_url || null,
          selfieUrl: self.secure_url,
        },
      });

      await this.prisma.user.update({
        where: { id: userId },
        data: { kycStatus: 'PENDING' },
      });

      console.log('[KYC SERVICE] KYC submitted successfully');

      return {
        message: 'KYC submitted successfully',
        kyc,
      };
    } catch (error) {
      console.error('[KYC SERVICE] Error submitting KYC:', error);
      throw error;
    }
  }

  async getMyKyc(userId: string) {
    console.log('[KYC SERVICE] Fetching user KYC:', userId);

    const kyc = await this.prisma.kyc.findUnique({
      where: { userId },
    });

    if (!kyc) {
      console.error('[KYC SERVICE] KYC not found');
      throw new NotFoundException('KYC not found');
    }

    return kyc;
  }

  async getAllKyc() {
    console.log('[KYC SERVICE] Fetching all KYC');
    return this.prisma.kyc.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async getKycById(id: string) {
    console.log('[KYC SERVICE] Fetching KYC by ID:', id);

    const kyc = await this.prisma.kyc.findUnique({
      where: { id },
    });

    if (!kyc) {
      console.error('[KYC SERVICE] KYC not found');
      throw new NotFoundException('KYC not found');
    }

    return kyc;
  }

  async approveKyc(id: string, adminId: string) {
    console.log('[KYC SERVICE] Approving KYC:', id);

    const kyc = await this.getKycById(id);

    const updated = await this.prisma.kyc.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });

    await this.prisma.user.update({
      where: { id: kyc.userId },
      data: { kycStatus: 'VERIFIED' },
    });

    console.log('[KYC SERVICE] KYC approved');

    return { message: 'KYC approved', kyc: updated };
  }

  async rejectKyc(id: string, adminId: string, reason: string) {
    console.log('[KYC SERVICE] Rejecting KYC:', id);

    if (!reason) {
      console.error('[KYC SERVICE] Missing rejection reason');
      throw new BadRequestException('Reason required');
    }

    const kyc = await this.getKycById(id);

    const updated = await this.prisma.kyc.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedBy: adminId,
      },
    });

    await this.prisma.user.update({
      where: { id: kyc.userId },
      data: { kycStatus: 'REJECTED' },
    });

    console.log('[KYC SERVICE] KYC rejected');

    return { message: 'KYC rejected', kyc: updated };
  }
}