import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { UserSettingsService } from '../services/user-settings.service.js';

@ApiTags('Payment Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('payment-settings')
export class PaymentSettingsController {
  constructor(private readonly userSettings: UserSettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get payout settings for the current user' })
  getSettings(@CurrentUser() user: { userId: string }) {
    return this.userSettings.getPaymentSettings(user.userId);
  }

  @Get('mobile-money/providers')
  @ApiOperation({
    summary: 'Get supported mobile money providers for a country',
  })
  @ApiQuery({ name: 'country', required: true, example: 'CM' })
  getProviders(@Query('country') country: string) {
    return this.userSettings.getSupportedMobileMoneyProviders(country);
  }

  @Post('mobile-money')
  @ApiOperation({ summary: 'Add a mobile money payout number' })
  addMobileMoneyNumber(
    @CurrentUser() user: { userId: string },
    @Body() body: { country: string; providerCode: string; phone: string },
  ) {
    return this.userSettings.addMobileMoneyNumber(user.userId, body);
  }

  @Post('mobile-money/:id/resend-otp')
  @ApiOperation({ summary: 'Resend OTP for a mobile money payout number' })
  resendOtp(
    @CurrentUser() user: { userId: string },
    @Param('id') settingId: string,
  ) {
    return this.userSettings.resendMobileMoneyOtp(user.userId, settingId);
  }

  @Post('mobile-money/verify')
  @ApiOperation({ summary: 'Verify a mobile money payout number' })
  verifyMobileMoneyNumber(
    @CurrentUser() user: { userId: string },
    @Body() body: { settingId: string; code: string },
  ) {
    return this.userSettings.verifyMobileMoneyNumber(
      user.userId,
      body.settingId,
      body.code,
    );
  }

  @Patch('mobile-money/:id/set-primary')
  @ApiOperation({ summary: 'Set a verified payout number as primary' })
  setPrimary(
    @CurrentUser() user: { userId: string },
    @Param('id') settingId: string,
  ) {
    return this.userSettings.setPrimaryMobileMoneyNumber(
      user.userId,
      settingId,
    );
  }

  @Delete('mobile-money/:id')
  @ApiOperation({ summary: 'Remove a payout number' })
  removeMobileMoneyNumber(
    @CurrentUser() user: { userId: string },
    @Param('id') settingId: string,
  ) {
    return this.userSettings.removeMobileMoneyNumber(user.userId, settingId);
  }
}
