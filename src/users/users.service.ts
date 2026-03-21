import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

import cloudinary from '../config/cloudinary.config.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  // =====================================================
  // 👤 GET CURRENT USER PROFILE
  // =====================================================
  async getMe(userId: string) {
    this.logger.log(`Fetching user profile for userId: ${userId}`);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        contacts: true,
        wallet: true,
        kyc: true,
      },
    });

    if (!user) {
      this.logger.warn(`User not found: ${userId}`);
      throw new NotFoundException('User not found');
    }

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`User fetched successfully: ${userId}`);

    return safeUser;
  }

  // =====================================================
  // ✏️ UPDATE USER PROFILE (TEXT DATA)
  // =====================================================
  async updateUser(userId: string, dto: UpdateUserDto) {
    this.logger.log(`Updating user profile: ${userId}`);

    if (!dto || Object.keys(dto).length === 0) {
      this.logger.warn(`Empty update payload for user: ${userId}`);
      throw new BadRequestException('No data provided for update');
    }

    const allowedData: Partial<UpdateUserDto> = {};

    if (dto.firstName) allowedData.firstName = dto.firstName;
    if (dto.lastName) allowedData.lastName = dto.lastName;
    if (dto.profilePicture) allowedData.profilePicture = dto.profilePicture;

    this.logger.debug(
      `Allowed update data for ${userId}: ${JSON.stringify(allowedData)}`,
    );

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: allowedData,
    });

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`User updated successfully: ${userId}`);

    return safeUser;
  }

  // =====================================================
  // 🖼️ UPLOAD & UPDATE PROFILE PICTURE
  // =====================================================
  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    this.logger.log(`Uploading profile picture for user: ${userId}`);

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // 🔐 Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.mimetype)) {
      this.logger.warn(`Invalid file type: ${file.mimetype}`);
      throw new BadRequestException('Only JPG, PNG, WEBP allowed');
    }

    // 🔍 Get existing user (for old image cleanup)
    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    // 🧹 OPTIONAL: Delete old image from Cloudinary
    if (existingUser.profilePicture) {
      try {
        const publicId = this.extractPublicId(existingUser.profilePicture);
        if (publicId) {
          await cloudinary.uploader.destroy(publicId);
          this.logger.log(`Old profile image deleted: ${publicId}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to delete old image: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 🚀 Upload with compression & optimization
    const result = await cloudinary.uploader.upload(`data:${file.mimetype};base64,${file.buffer.toString('base64')}`, {
      folder: `tchokopay/users/${userId}`,

      // 🔥 IMAGE OPTIMIZATION (VERY IMPORTANT)
      transformation: [
        {
          width: 500,
          height: 500,
          crop: 'fill', // ensures square profile pic
          gravity: 'face', // focus on face
        },
        {
          quality: 'auto', // auto compression
          fetch_format: 'auto', // auto convert (webp, etc.)
        },
      ],
    });

    this.logger.debug(
      `Cloudinary upload result: ${JSON.stringify(result.secure_url)}`,
    );

    // 💾 Save new image URL
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        profilePicture: result.secure_url,
      },
    });

    const { password, refreshToken, googleId, ...safeUser } = user;

    this.logger.log(`Profile picture updated successfully: ${userId}`);

    return safeUser;
  }

  // =====================================================
  // 🧰 HELPER: Extract Cloudinary Public ID
  // =====================================================
  private extractPublicId(url: string): string | null {
    try {
      const parts = url.split('/');
      const fileName = parts.pop();
      const folder = parts.slice(parts.indexOf('upload') + 1).join('/');

      if (!fileName) return null;

      const publicId = `${folder}/${fileName.split('.')[0]}`;
      return publicId;
    } catch {
      return null;
    }
  }
}