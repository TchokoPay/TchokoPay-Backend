export type PayinDto = {
  amount: number;
  currency: string;
  phone?: string;
  reference: string;
  metadata?: Record<string, any>;
};

export type PayoutDto = {
  amount: number;
  currency: string;
  phone?: string;
  reference: string;
  metadata?: Record<string, any>;
};