import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import cookieParser from 'cookie-parser';

import helmet from 'helmet';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

// 🔐 Global Auth Guard
import { JwtAuthGuard } from './auth/guards/jwt.guard.js';
import { APP_GUARD } from '@nestjs/core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 🛡️ Security headers
  app.use(helmet());

  // 🌍 CORS (adjust for your frontend)
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
  });

  // 🍪 Cookies
  app.use(cookieParser());

  // ✅ Validation globally
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // 🔐 GLOBAL JWT GUARD (configured in AuthModule with APP_GUARD)

  // 📘 Swagger setup
  const config = new DocumentBuilder()
    .setTitle('TchokoPay API')
    .setDescription('TchokoPay backend API documentation')
    .setVersion('1.0')
    .addBearerAuth() // enables "Authorize" button in Swagger
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
bootstrap();