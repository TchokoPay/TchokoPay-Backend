import {
  Controller,
  Post,
  Body,
  UseGuards,
  Param,
  Patch,
  Delete,
  Get,
  Query,
} from '@nestjs/common';

import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiOperation,
} from '@nestjs/swagger';

import { ContactsService } from './contacts.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

import { AddContactDto } from './dto/add-contact.dto.js';
import { VerifyContactDto } from './dto/verify-contact.dto.js';

@ApiTags('Contacts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  // =====================================================
  // 📥 GET USER CONTACTS (WITH FILTERS + PAGINATION)
  // =====================================================
  @Get()
  @ApiOperation({ summary: 'Get user contacts' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 10 })
  @ApiQuery({ name: 'isVerified', required: false, example: true })
  getContacts(
    @CurrentUser() user: any,
    @Query() query: any,
  ) {
    return this.contactsService.getUserContacts(
      user.userId,
      query,
    );
  }

  // =====================================================
  // ➕ ADD OR UPDATE CONTACT
  // =====================================================
  @Post()
  @ApiOperation({
    summary:
      'Add or update contact (email or phone). OTP required',
  })
  addContact(
    @CurrentUser() user: any,
    @Body() dto: AddContactDto,
  ) {
    return this.contactsService.addContact(user.userId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update an existing contact. OTP required after change',
  })
  updateContact(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
    @Body() dto: AddContactDto,
  ) {
    return this.contactsService.updateContact(user.userId, contactId, dto);
  }

  // =====================================================
  // 🔁 RESEND OTP
  // =====================================================
  @Post(':id/resend-otp')
  @ApiOperation({
    summary: 'Resend OTP for contact verification',
  })
  resendOtp(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
  ) {
    return this.contactsService.resendOtp(user.userId, contactId);
  }

  // =====================================================
  // ✅ VERIFY CONTACT
  // =====================================================
  @Post('verify')
  @ApiOperation({
    summary: 'Verify contact using OTP',
  })
  verify(
    @CurrentUser() user: any,
    @Body() dto: VerifyContactDto,
  ) {
    return this.contactsService.verifyContact(
      user.userId,
      dto.contactId,
      dto.code,
    );
  }

  @Post(':id/cancel-pending-change')
  @ApiOperation({
    summary: 'Cancel a pending contact change',
  })
  cancelPendingChange(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
  ) {
    return this.contactsService.cancelPendingChange(
      user.userId,
      contactId,
    );
  }

  // =====================================================
  // ⭐ SET PRIMARY CONTACT
  // =====================================================
  @Patch(':id/set-primary')
  @ApiOperation({
    summary: 'Set a contact as primary',
  })
  setPrimary(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
  ) {
    return this.contactsService.setPrimary(
      user.userId,
      contactId,
    );
  }

  // =====================================================
  // ❌ DELETE CONTACT
  // =====================================================
  @Delete(':id')
  @ApiOperation({
    summary: 'Delete a contact',
  })
  delete(
    @CurrentUser() user: any,
    @Param('id') contactId: string,
  ) {
    return this.contactsService.deleteContact(
      user.userId,
      contactId,
    );
  }
}
