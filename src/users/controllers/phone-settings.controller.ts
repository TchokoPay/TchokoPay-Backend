import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard.js';
import { UserSettingsService } from '../services/user-settings.service.js';

@Controller('phone-settings')
@UseGuards(JwtAuthGuard)
export class PhoneSettingsController {
  constructor(private userSettings: UserSettingsService) {}

  /**
   * GET /phone-settings
   * Get all phone numbers user has configured for payment methods
   */
  @Get()
  async getAllPhoneSettings(@Req() req) {
    const userId = req.user.id;
    const settings = await this.userSettings.getAllPhoneSettings(userId);
    return {
      message: 'Phone settings retrieved',
      data: settings,
    };
  }

  /**
   * GET /phone-settings/:paymentMethod
   * Get phone number for a specific payment method
   */
  @Get(':paymentMethod')
  async getPhoneForMethod(
    @Req() req,
    @Param('paymentMethod') paymentMethod: string,
  ) {
    const userId = req.user.id;
    const phone = await this.userSettings.getPhoneForPaymentMethod(
      userId,
      paymentMethod,
    );

    return {
      message: 'Phone setting retrieved',
      paymentMethod,
      phone,
    };
  }

  /**
   * POST /phone-settings/:paymentMethod
   * Set phone number for a specific payment method
   *
   * @body { phone: string } - Phone number to set
   */
  @Post(':paymentMethod')
  @HttpCode(201)
  async setPhoneForMethod(
    @Req() req,
    @Param('paymentMethod') paymentMethod: string,
    @Body() body: { phone: string },
  ) {
    const userId = req.user.id;

    if (!body.phone) {
      throw new BadRequestException('Phone number is required');
    }

    const phoneSettings = await this.userSettings.setPhoneForPaymentMethod(
      userId,
      paymentMethod,
      body.phone,
    );

    return {
      message: `Phone set for ${paymentMethod}`,
      data: phoneSettings,
    };
  }

  /**
   * PUT /phone-settings/:paymentMethod
   * Update phone number for a specific payment method
   *
   * @body { phone: string } - New phone number
   */
  @Put(':paymentMethod')
  async updatePhoneForMethod(
    @Req() req,
    @Param('paymentMethod') paymentMethod: string,
    @Body() body: { phone: string },
  ) {
    const userId = req.user.id;

    if (!body.phone) {
      throw new BadRequestException('Phone number is required');
    }

    const phoneSettings = await this.userSettings.setPhoneForPaymentMethod(
      userId,
      paymentMethod,
      body.phone,
    );

    return {
      message: `Phone updated for ${paymentMethod}`,
      data: phoneSettings,
    };
  }

  /**
   * GET /phone-settings/methods/available
   * Get all available payout methods for the user
   */
  @Get('methods/available')
  async getAvailablePayoutMethods(@Req() req) {
    const userId = req.user.id;
    const methods = await this.userSettings.getAvailablePayoutMethods(userId);

    return {
      message: 'Available payout methods',
      data: methods,
    };
  }
}
