/*
  Warnings:

  - A unique constraint covering the columns `[userId,currencyId]` on the table `Wallet` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Wallet_userId_key";

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_currencyId_idx" ON "Wallet"("currencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_currencyId_key" ON "Wallet"("userId", "currencyId");
