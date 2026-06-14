/* eslint-disable prettier/prettier */
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client, TokenPayload } from 'google-auth-library';

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private client: OAuth2Client;

  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  // =========================
  // 🌐 VERIFY GOOGLE TOKEN
  // =========================
  async verifyGoogleToken(token: string) {
    if (!token) {
      throw new UnauthorizedException('Google token is required');
    }

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload: TokenPayload | undefined = ticket.getPayload();

      if (!payload) {
        throw new UnauthorizedException('Invalid Google token');
      }

      const {
        sub: googleId,
        email,
        given_name,
        family_name,
        picture,
        email_verified,
      } = payload;

      if (!email || !googleId) {
        throw new UnauthorizedException('Google account is missing required data');
      }

      if (!email_verified) {
        throw new UnauthorizedException('Google email not verified');
      }

      return {
        googleId,
        email,
        firstName: given_name || '',
        lastName: family_name || '',
        picture: picture || null,
      };
    } catch (error) {
      // Preserve specific, user-actionable messages (e.g. "Google email not
      // verified") thrown above instead of masking them with a generic one.
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      this.logger.error(
        `Google token verification failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new UnauthorizedException('Google authentication failed');
    }
  }
}