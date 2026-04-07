/*
  Warnings:

  - Added the required column `amountType` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "QuoteAmountType" AS ENUM ('PAY', 'RECEIVE');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "amountType" "QuoteAmountType" NOT NULL;

-- CreateIndex
CREATE INDEX "Quote_amountType_idx" ON "Quote"("amountType");
