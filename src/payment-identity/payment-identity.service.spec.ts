import { Test, TestingModule } from '@nestjs/testing';
import { PaymentIdentityService } from './payment-identity.service';

describe('PaymentIdentityService', () => {
  let service: PaymentIdentityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PaymentIdentityService],
    }).compile();

    service = module.get<PaymentIdentityService>(PaymentIdentityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
