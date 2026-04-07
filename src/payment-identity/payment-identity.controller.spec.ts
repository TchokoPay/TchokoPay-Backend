import { Test, TestingModule } from '@nestjs/testing';
import { PaymentIdentityController } from './payment-identity.controller';

describe('PaymentIdentityController', () => {
  let controller: PaymentIdentityController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentIdentityController],
    }).compile();

    controller = module.get<PaymentIdentityController>(PaymentIdentityController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
