/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtService } from '@nestjs/jwt';

describe('AuthService', () => {
  let service: AuthService;

  // 🔥 Mock Prisma (important)
  const mockPrisma = {
    user: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    userContact: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    verificationCode: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  // 🔥 Mock JWT
  const mockJwt = {
    sign: jest.fn().mockReturnValue('test_token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: JwtService,
          useValue: mockJwt,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ✅ Basic test
  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ✅ Signup test
  it('should create a user on signup', async () => {
    mockPrisma.userContact.findFirst.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-id',
    });
    mockPrisma.userContact.create.mockResolvedValue({
      id: 'contact-id',
    });

    const result = await service.signup({
      email: 'test@gmail.com',
      password: '123456',
      firstName: 'John',
      lastName: 'Doe',
    });

    expect(result.message).toBeDefined();
  });

  // ✅ Login test
  it('should login user and return tokens', async () => {
    mockPrisma.userContact.findFirst.mockResolvedValue({
      isVerified: true,
      user: {
        id: 'user-id',
        password: await require('bcrypt').hash('123456', 10),
      },
    });

    mockPrisma.user.update.mockResolvedValue({});

    const result = await service.login({
      identifier: 'test@gmail.com',
      password: '123456',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.refreshToken).toBeDefined();
  });
 
});