/* eslint-disable prettier/prettier */
import { JwtService } from '@nestjs/jwt';

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

  console.log('⚙️ Generating tokens for:', { sub: payload.sub, identifier: payload.identifier, role });

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
