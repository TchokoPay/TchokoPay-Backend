/*
  Warnings:

  - Added the required column `paymentMethod` to the `PaymentInvoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `paymentMethod` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payoutMethod` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentFlow" AS ENUM ('DIRECT', 'QR', 'REQUEST');

-- AlterTable
ALTER TABLE "FeeConfig" ADD COLUMN     "payoutMethod" TEXT;

-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "flow" TEXT;

-- AlterTable
ALTER TABLE "PaymentInvoice" ADD COLUMN     "flow" TEXT,
ADD COLUMN     "paymentMethod" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "flow" TEXT,
ADD COLUMN     "paymentMethod" TEXT NOT NULL,
ADD COLUMN     "payoutMethod" TEXT NOT NULL;
