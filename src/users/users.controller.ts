import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';

import { FileInterceptor } from '@nestjs/platform-express';
import * as multer from 'multer';

import { UsersService } from './users.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // =====================================================
  // 👤 GET CURRENT USER
  // =====================================================
  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getMe(@CurrentUser() user: any) {
    return this.usersService.getMe(user.userId);
  }

  // =====================================================
  // ✏️ UPDATE USER PROFILE (TEXT)
  // =====================================================
  @Patch('me')
  @ApiOperation({ summary: 'Update user profile (name, picture URL)' })
  updateUser(
    @CurrentUser() user: any,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.updateUser(user.userId, dto);
  }

  // =====================================================
  // 📋 GET TRANSACTION HISTORY
  // =====================================================
  @Get('me/transactions')
  @ApiOperation({ summary: 'Get current user transaction history' })
  getMyTransactions(@CurrentUser() user: any) {
    return this.usersService.getMyTransactions(user.userId);
  }

  // =====================================================
  // 🖼️ UPLOAD PROFILE PICTURE
  // =====================================================
  @Patch('upload-profile-picture')
  @ApiOperation({ summary: 'Upload and update profile picture' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB limit
      },
      fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

        if (!allowedTypes.includes(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Only JPG, PNG, and WEBP files are allowed',
            ),
            false,
          );
        }

        cb(null, true);
      },
    }),
  )
  uploadProfilePicture(
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.usersService.uploadProfilePicture(user.userId, file);
  }
}