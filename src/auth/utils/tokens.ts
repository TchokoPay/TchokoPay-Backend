/* eslint-disable prettier/prettier */
import { JwtService } from '@nestjs/jwt';

/** Decode a JWT payload without verification — use only on tokens you just generated. */
export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function generateTokens(
  jwtService: JwtService,
  userId: string,
  identifier: string,
  role: string = 'USER',
) {
  const payload = {
    sub: userId,
    identifier,
    role,
  };

  // 🔑 ACCESS TOKEN (15 min)
  const accessToken = await jwtService.signAsync(payload, {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: '15m',
  });

  // 🔁 REFRESH TOKEN (7 days)
  const refreshToken = await jwtService.signAsync(payload, {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d',
  });

  return { accessToken, refreshToken };
}
