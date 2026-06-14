import {
  Controller,
  Get,
  Delete,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SessionsService } from './sessions.service.js';
import type { Request } from 'express';

@ApiTags('Sessions')
@ApiBearerAuth()
@Controller('auth/sessions')
export class SessionsController {
  constructor(private sessions: SessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all active sessions for the current user' })
  list(@Req() req: Request & { user?: { userId?: string } }) {
    const userId = req.user?.userId!;
    return this.sessions.listSessions(userId);
  }

  @Delete('others')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke all sessions except the current device' })
  revokeOthers(
    @Req() req: Request & { user?: { userId?: string } },
    @Body('currentDeviceHash') currentDeviceHash?: string,
  ) {
    const userId = req.user?.userId!;
    return this.sessions.revokeAllOtherSessions(userId, currentDeviceHash);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a specific session' })
  revoke(
    @Req() req: Request & { user?: { userId?: string } },
    @Param('id') sessionId: string,
  ) {
    const userId = req.user?.userId!;
    return this.sessions.revokeSession(userId, sessionId);
  }
}
