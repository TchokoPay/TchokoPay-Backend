import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
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

  // ── Users ─────────────────────────────────────────────────────────────────

  @Get('users')
  @ApiOperation({ summary: 'List all users with filters' })
  @ApiQuery({ name: 'page',     required: false, example: 1 })
  @ApiQuery({ name: 'limit',    required: false, example: 20 })
  @ApiQuery({ name: 'search',   required: false })
  @ApiQuery({ name: 'role',     required: false, enum: ['USER', 'ADMIN'] })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'kycStatus',required: false, enum: ['PENDING', 'VERIFIED', 'REJECTED'] })
  listUsers(
    @Query('page',    new DefaultValuePipe(1),  ParseIntPipe) page: number,
    @Query('limit',   new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search')   search?: string,
    @Query('role')     role?: string,
    @Query('isActive') isActive?: string,
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

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  @Post('bootstrap')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Promote first admin (one-time, requires ADMIN_BOOTSTRAP_TOKEN)' })
  bootstrap(
    @Body('email') email: string,
    @Body('bootstrapToken') bootstrapToken: string,
  ) {
    return this.admin.bootstrapAdmin(email, bootstrapToken);
  }
}
