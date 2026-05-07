import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
import { AdminGuard } from './guards/admin.guard.js';
import { JwtAuthGuard } from '../auth/guards/jwt.guard.js';

type AuthenticatedRequest = { user: { userId: string }; ip?: string };

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService) {}

  // ── Overview ──────────────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Platform overview stats' })
  getStats() {
    return this.admin.getStats();
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({ summary: 'Time-series analytics for the given period' })
  @ApiQuery({ name: 'period', required: false, enum: ['7d', '30d', '90d'] })
  getAnalytics(@Query('period') period: '7d' | '30d' | '90d' = '30d') {
    return this.admin.getAnalytics(period);
  }

  // ── Users ─────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users with filters' })
  @ApiQuery({ name: 'page',      required: false, example: 1 })
  @ApiQuery({ name: 'limit',     required: false, example: 20 })
  @ApiQuery({ name: 'search',    required: false })
  @ApiQuery({ name: 'role',      required: false, enum: ['USER', 'ADMIN'] })
  @ApiQuery({ name: 'isActive',  required: false })
  @ApiQuery({ name: 'kycStatus', required: false, enum: ['PENDING', 'VERIFIED', 'REJECTED'] })
  listUsers(
    @Query('page',     new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit',    new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search')    search?: string,
    @Query('role')      role?: string,
    @Query('isActive')  isActive?: string,
    @Query('kycStatus') kycStatus?: string,
  ) {
    return this.admin.listUsers({
      page,
      limit: Math.min(limit, 100),
      search,
      role,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      kycStatus,
    });
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Get full user detail' })
  getUserDetail(@Param('id') id: string) {
    return this.admin.getUserDetail(id);
  }

  @Patch('users/:id/role')
  @ApiOperation({ summary: 'Promote or demote a user' })
  setRole(
    @Req() req: AuthenticatedRequest,
    @Param('id') userId: string,
    @Body('role') role: 'USER' | 'ADMIN',
  ) {
    return this.admin.setUserRole(req.user.userId, userId, role, req.ip);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Activate or ban a user' })
  setStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id') userId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.admin.setUserStatus(req.user.userId, userId, isActive, req.ip);
  }

  // ── Invoices / Transactions ───────────────────────────────────────────────

  @Get('invoices')
  @ApiOperation({ summary: 'List all payment invoices' })
  @ApiQuery({ name: 'page',    required: false })
  @ApiQuery({ name: 'limit',   required: false })
  @ApiQuery({ name: 'status',  required: false })
  @ApiQuery({ name: 'flow',    required: false })
  @ApiQuery({ name: 'country', required: false })
  @ApiQuery({ name: 'search',  required: false })
  listInvoices(
    @Query('page',    new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit',   new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status')  status?: string,
    @Query('flow')    flow?: string,
    @Query('country') country?: string,
    @Query('search')  search?: string,
  ) {
    return this.admin.listInvoices({ page, limit: Math.min(limit, 100), status, flow, country, search });
  }

  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get invoice detail with full audit trail' })
  getInvoice(@Param('id') id: string) {
    return this.admin.getInvoiceDetail(id);
  }

  // ── KYC ──────────────────────────────────────────────────────────────────

  @Get('kyc')
  @ApiOperation({ summary: 'List KYC submissions' })
  @ApiQuery({ name: 'status', required: false, enum: ['PENDING', 'VERIFIED', 'REJECTED'] })
  listKyc(
    @Query('page',   new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit',  new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
  ) {
    return this.admin.listKyc({ page, limit, status });
  }

  @Patch('kyc/:id/review')
  @ApiOperation({ summary: 'Approve or reject a KYC submission' })
  reviewKyc(
    @Req() req: AuthenticatedRequest,
    @Param('id') kycId: string,
    @Body('decision') decision: 'VERIFIED' | 'REJECTED',
    @Body('reason') reason?: string,
  ) {
    return this.admin.reviewKyc(req.user.userId, kycId, decision, reason, req.ip);
  }

  // ── Pricing (admin-audited) ───────────────────────────────────────────────

  @Get('pricing')
  @ApiOperation({ summary: 'List all fee configurations' })
  listPricing() {
    return this.admin.listAdminPricing();
  }

  @Post('pricing')
  @ApiOperation({ summary: 'Create a fee configuration rule' })
  createPricing(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    return this.admin.createPricing(req.user.userId, dto, req.ip);
  }

  @Patch('pricing/:id')
  @ApiOperation({ summary: 'Update a fee configuration rule' })
  updatePricing(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    return this.admin.updatePricing(req.user.userId, id, dto, req.ip);
  }

  @Delete('pricing/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a fee configuration rule' })
  deletePricing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.admin.deletePricing(req.user.userId, id, req.ip);
  }

  @Patch('pricing/:id/toggle')
  @ApiOperation({ summary: 'Toggle a fee configuration active state' })
  togglePricing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.admin.togglePricing(req.user.userId, id, req.ip);
  }

  // ── Audit log ─────────────────────────────────────────────────────────────

  @Get('audit-log')
  @ApiOperation({ summary: 'View admin audit trail' })
  getAuditLog(
    @Query('page',    new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit',   new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('adminId') adminId?: string,
    @Query('action')  action?: string,
  ) {
    return this.admin.getAuditLog({ page, limit: Math.min(limit, 200), adminId, action });
  }
}
