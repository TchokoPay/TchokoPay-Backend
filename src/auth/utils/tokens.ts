/* eslint-disable prettier/prettier */
import { JwtService } from '@nestjs/jwt';

export async function generateTokens(
  jwtService: JwtService,
  userId: string,
  identifier: string,
) {
  const payload = {
    sub: userId,
    identifier,
  };

  console.log('⚙️ Generating tokens for:', payload);

  // 🔑 ACCESS TOKEN
  const accessToken = await jwtService.signAsync(payload, {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: '15m',
  });

  // 🔁 REFRESH TOKEN
  const refreshToken = await jwtService.signAsync(payload, {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d',
  });

  console.log('✅ Tokens generated:');
  console.log('ACCESS:', accessToken);
  console.log('REFRESH:', refreshToken);

  return {
    accessToken,
    refreshToken,
  };
}