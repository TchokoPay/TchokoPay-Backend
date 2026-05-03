export enum FlowType {
  DIRECT = 'DIRECT',
  QR = 'QR',
  REQUEST = 'REQUEST',
}

export enum PaymentAction {
  CREATE = 'CREATE',
  PAY = 'PAY',
}

// All currencies supported across Netwalletpay countries + crypto
export enum CurrencyCode {
  // Crypto
  BTC = 'BTC',
  SAT = 'SAT',
  USDT = 'USDT',
  // Africa — Netwalletpay fiat currencies
  XAF = 'XAF',
  UGX = 'UGX',
  KES = 'KES',
  TZS = 'TZS',
  RWF = 'RWF',
  BIF = 'BIF',
  GHS = 'GHS',
  ZMW = 'ZMW',
  ZAR = 'ZAR',
  NGN = 'NGN',
  // Asia
  MYR = 'MYR',
}

export enum AmountType {
  PAY = 'PAY',
  RECEIVE = 'RECEIVE',
}
