/*
  Warnings:

  - You are about to drop the column `currency` on the `PaymentAttempt` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `PaymentInvoice` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Wallet` table. All the data in the column will be lost.
  - Added the required column `currencyId` to the `PaymentAttempt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currencyId` to the `PaymentInvoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currencyId` to the `Transaction` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currencyId` to the `Wallet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PaymentAttempt" DROP COLUMN "currency",
ADD COLUMN     "currencyId" TEXT NOT NULL,
ADD COLUMN     "fee" DECIMAL(65,30),
ADD COLUMN     "netAmount" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "PaymentInvoice" DROP COLUMN "currency",
ADD COLUMN     "currencyId" TEXT NOT NULL,
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "currency",
ADD COLUMN     "baseAmount" DECIMAL(65,30),
ADD COLUMN     "baseCurrencyId" TEXT,
ADD COLUMN     "currencyId" TEXT NOT NULL,
ADD COLUMN     "paymentStatus" TEXT,
ADD COLUMN     "payoutStatus" TEXT,
ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "rateSource" TEXT,
ADD COLUMN     "rateTimestamp" TIMESTAMP(3),
ADD COLUMN     "targetAmount" DECIMAL(65,30),
ADD COLUMN     "targetCurrencyId" TEXT;

-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "currency",
ADD COLUMN     "currencyId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "decimals" INTEGER NOT NULL,
    "isCrypto" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "baseCurrencyId" TEXT NOT NULL,
    "targetCurrencyId" TEXT NOT NULL,
    "baseAmount" DECIMAL(65,30) NOT NULL,
    "targetAmount" DECIMAL(65,30) NOT NULL,
    "exchangeRate" DECIMAL(65,30) NOT NULL,
    "fee" DECIMAL(65,30),
    "rateSource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ledger" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "transactionId" TEXT,
    "invoiceId" TEXT,
    "amount" DECIMAL(65,30) NOT NULL,
    "type" TEXT NOT NULL,
    "balanceAfter" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE INDEX "Quote_baseCurrencyId_idx" ON "Quote"("baseCurrencyId");

-- CreateIndex
CREATE INDEX "Quote_targetCurrencyId_idx" ON "Quote"("targetCurrencyId");

-- CreateIndex
CREATE INDEX "Ledger_walletId_idx" ON "Ledger"("walletId");

-- CreateIndex
CREATE INDEX "Ledger_transactionId_idx" ON "Ledger"("transactionId");

-- CreateIndex
CREATE INDEX "Ledger_invoiceId_idx" ON "Ledger"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentInvoice_currencyId_idx" ON "PaymentInvoice"("currencyId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_baseCurrencyId_fkey" FOREIGN KEY ("baseCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_targetCurrencyId_fkey" FOREIGN KEY ("targetCurrencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ledger" ADD CONSTRAINT "Ledger_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PaymentInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
