import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt.guard.js';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { UserSettingsService } from '../services/user-settings.service.js';

/**
 * 🚀 FUTURE UPGRADE: Payment Settings Controller
 *
 * Manages user's payment method configurations:
 * - MOMO (Mobile Money - phone-based)
 * - OM (Orange Money - phone-based)
 * - Banks (bank account-based)
 * - Crypto (wallet address-based)
 *
 * MVP Status:
 * - Structure is in place for future implementation
 * - Currently: System fetches verified contact from contacts table automatically
 * - These endpoints return basic structure, full customization coming soon
 */
@ApiTags('Payment Settings')
@ApiBearerAuth()
@Controller('payment-settings')
@UseGuards(JwtAuthGuard)
export class PaymentSettingsController {
  constructor(private userSettings: UserSettingsService) {}

  /**
   * GET /payment-settings
   * Retrieve all configured payment methods
   */
  @Get()
  @ApiOperation({
    summary: 'Get all payment settings',
    description:
      'Retrieves all payment methods configured by the user (MOMO, OM, Banks, Crypto). MVP: Returns structure, actual data from verified contacts.',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment settings retrieved successfully',
    schema: {
      example: {
        message: 'Payment settings retrieved',
        data: [
          {
            paymentMethod: 'MOMO',
            phone: '+237612345678',
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllPaymentSettings(@CurrentUser() user: { userId: string }) {
    const userId = user.userId;
    const settings = await this.userSettings.getAllPhoneSettings(userId);
    return {
      message: 'Payment settings retrieved',
      data: settings,
    };
  }

  /**
   * GET /payment-settings/:method
   * Retrieve a specific payment method
   */
  @Get(':method')
  @ApiOperation({
    summary: 'Get payment method details',
    description: 'Retrieve configuration for a specific payment method (MOMO, OM, BANK, CRYPTO)',
  })
  @ApiParam({
    name: 'method',
    description: 'Payment method: MOMO, OM, BANK, or CRYPTO',
    example: 'MOMO',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment method details retrieved',
    schema: {
      example: {
        message: 'MOMO payment method retrieved',
        method: 'MOMO',
        phone: '+237612345678',
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getPaymentMethod(
    @CurrentUser() user: { userId: string },
    @Param('method') method: string,
  ) {
    const userId = user.userId;
    const phone = await this.userSettings.getPhoneForPaymentMethod(userId, method);

    return {
      message: `${method} payment method retrieved`,
      method: method.toUpperCase(),
      phone,
    };
  }

  /**
   * POST /payment-settings/:method
   * Configure a payment method for the first time
   */
  @Post(':method')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add payment method',
    description:
      'Configure a new payment method. MVP: Supports MOMO/OM via phone. Future: Banks and Crypto via account/address.',
  })
  @ApiParam({
    name: 'method',
    description: 'Payment method: MOMO, OM, BANK (future), or CRYPTO (future)',
    example: 'MOMO',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'MOMO/OM: Phone number with country code. E.g., +237612345678',
          example: '+237612345678',
        },
        accountNumber: {
          type: 'string',
          description: '[FUTURE] Bank account number',
        },
        accountName: {
          type: 'string',
          description: '[FUTURE] Account holder name',
        },
        address: {
          type: 'string',
          description: '[FUTURE] Crypto wallet address',
        },
      },
      required: ['phone'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Payment method configured successfully',
    schema: {
      example: {
        message: 'MOMO payment method configured',
        data: {
          userId: 'user-123',
          paymentMethod: 'MOMO',
          phone: '+237612345678',
          createdAt: '2026-03-25T10:30:00Z',
          updatedAt: '2026-03-25T10:30:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request (missing required fields)' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async addPaymentMethod(
    @CurrentUser() user: { userId: string },
    @Param('method') method: string,
    @Body() body: any,
  ) {
    const userId = user.userId;
    const methodUpper = method.toUpperCase();

    // MVP: only support phone-based methods
    if (!['MOMO', 'OM', 'ORANGE'].includes(methodUpper)) {
      throw new BadRequestException(
        `Method ${methodUpper} not yet supported. Future upgrade coming for banks and crypto.`,
      );
    }

    if (!body.phone) {
      throw new BadRequestException('Phone number is required');
    }

    const paymentSettings = await this.userSettings.setPhoneForPaymentMethod(
      userId,
      methodUpper,
      body.phone,
    );

    return {
      message: `${methodUpper} payment method configured`,
      data: paymentSettings,
    };
  }

  /**
   * PUT /payment-settings/:method
   * Update an existing payment method
   */
  @Put(':method')
  @ApiOperation({
    summary: 'Update payment method',
    description: 'Update configuration for an existing payment method',
  })
  @ApiParam({
    name: 'method',
    description: 'Payment method to update: MOMO, OM, BANK, or CRYPTO',
    example: 'MOMO',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'New phone number for MOMO/OM',
          example: '+237699999999',
        },
      },
      required: ['phone'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Payment method updated successfully',
    schema: {
      example: {
        message: 'MOMO payment method updated',
        data: {
          userId: 'user-123',
          paymentMethod: 'MOMO',
          phone: '+237699999999',
          updatedAt: '2026-03-25T10:35:00Z',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async updatePaymentMethod(
    @CurrentUser() user: { userId: string },
    @Param('method') method: string,
    @Body() body: any,
  ) {
    const userId = user.userId;
    const methodUpper = method.toUpperCase();

    if (!body.phone) {
      throw new BadRequestException('Phone number is required');
    }

    const paymentSettings = await this.userSettings.setPhoneForPaymentMethod(
      userId,
      methodUpper,
      body.phone,
    );

    return {
      message: `${methodUpper} payment method updated`,
      data: paymentSettings,
    };
  }

  /**
   * GET /payment-settings/methods/available
   * List all available payment methods
   */
  @Get('methods/available')
  @ApiOperation({
    summary: 'Get available payment methods',
    description:
      'Returns list of all payment methods user has configured (phone-based: MOMO, OM; bank accounts; crypto wallets)',
  })
  @ApiResponse({
    status: 200,
    description: 'Available payment methods retrieved',
    schema: {
      example: {
        message: 'Available payment methods',
        count: 2,
        methods: [
          {
            type: 'PHONE',
            method: 'MOMO',
            available: true,
          },
          {
            type: 'PHONE',
            method: 'ORANGE',
            available: true,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAvailableMethods(@CurrentUser() user: { userId: string }) {
    const userId = user.userId;
    const methods = await this.userSettings.getAvailablePayoutMethods(userId);

    return {
      message: 'Available payment methods',
      count: methods.length,
      methods,
    };
  }
}
