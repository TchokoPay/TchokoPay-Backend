/*
  Warnings:

  - You are about to drop the column `description` on the `PaymentRequest` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the column `invoiceId` on the `Transaction` table. All the data in the column will be lost.
  - You are about to drop the `Invoice` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Payout` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_userId_fkey";

-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_invoiceId_fkey";

-- DropIndex
DROP INDEX "Transaction_invoiceId_idx";

-- AlterTable
ALTER TABLE "PaymentRequest" DROP COLUMN "description",
ALTER COLUMN "expiresAt" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "description",
DROP COLUMN "invoiceId";

-- DropTable
DROP TABLE "Invoice";

-- DropTable
DROP TABLE "Payout";

-- DropEnum
DROP TYPE "PaymentMethod";

-- DropEnum
DROP TYPE "PayoutMethod";
