/*
  Warnings:

  - The `flow` column on the `PaymentAttempt` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `flow` column on the `PaymentInvoice` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `paymentMethod` column on the `PaymentInvoice` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `exchangeRate` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `fee` on the `Quote` table. All the data in the column will be lost.
  - You are about to drop the column `rateSource` on the `Quote` table. All the data in the column will be lost.
  - Changed the type of `type` on the `Ledger` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `flow` to the `Quote` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `paymentMethod` on the `Quote` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `payoutMethod` on the `Quote` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable for Ledger.type
ALTER TABLE "Ledger" ALTER COLUMN "type" TYPE "LedgerEntryType" USING "type"::text::"LedgerEntryType";

-- AlterTable for PaymentAttempt.flow
ALTER TABLE "PaymentAttempt" ADD COLUMN "flow_new" "PaymentFlow";
UPDATE "PaymentAttempt" SET "flow_new" = CASE
  WHEN "flow" IN ('DIRECT', 'QR', 'REQUEST') THEN "flow"::"PaymentFlow"
  ELSE 'DIRECT'::"PaymentFlow"
END;
ALTER TABLE "PaymentAttempt" DROP COLUMN "flow";
ALTER TABLE "PaymentAttempt" RENAME COLUMN "flow_new" TO "flow";

-- AlterTable for PaymentInvoice.flow and paymentMethod
ALTER TABLE "PaymentInvoice" ADD COLUMN "flow_new" "PaymentFlow";
UPDATE "PaymentInvoice" SET "flow_new" = CASE
  WHEN "flow" IN ('DIRECT', 'QR', 'REQUEST') THEN "flow"::"PaymentFlow"
  ELSE 'DIRECT'::"PaymentFlow"
END;
ALTER TABLE "PaymentInvoice" DROP COLUMN "flow";
ALTER TABLE "PaymentInvoice" RENAME COLUMN "flow_new" TO "flow";

ALTER TABLE "PaymentInvoice" ADD COLUMN "paymentMethod_new" "PaymentMethod";
UPDATE "PaymentInvoice" SET "paymentMethod_new" = CASE
  WHEN "paymentMethod" IN ('BTC', 'LIGHTNING', 'MOMO', 'ORANGE', 'CARD', 'BANK') THEN "paymentMethod"::"PaymentMethod"
  ELSE 'MOMO'::"PaymentMethod"
END;
ALTER TABLE "PaymentInvoice" DROP COLUMN "paymentMethod";
ALTER TABLE "PaymentInvoice" RENAME COLUMN "paymentMethod_new" TO "paymentMethod";

-- AlterTable for Quote fields and enums
ALTER TABLE "Quote" DROP COLUMN "exchangeRate";
ALTER TABLE "Quote" DROP COLUMN "fee";
ALTER TABLE "Quote" DROP COLUMN "rateSource";

ALTER TABLE "Quote" ADD COLUMN "flow_new" "PaymentFlow";
UPDATE "Quote" SET "flow_new" = CASE
  WHEN "flow" IN ('DIRECT', 'QR', 'REQUEST') THEN "flow"::"PaymentFlow"
  ELSE 'DIRECT'::"PaymentFlow"
END;
ALTER TABLE "Quote" DROP COLUMN "flow";
ALTER TABLE "Quote" RENAME COLUMN "flow_new" TO "flow";

ALTER TABLE "Quote" ADD COLUMN "paymentMethod_new" "PaymentMethod";
UPDATE "Quote" SET "paymentMethod_new" = CASE
  WHEN "paymentMethod" IN ('BTC', 'LIGHTNING', 'MOMO', 'ORANGE', 'CARD', 'BANK') THEN "paymentMethod"::"PaymentMethod"
  ELSE 'MOMO'::"PaymentMethod"
END;
ALTER TABLE "Quote" DROP COLUMN "paymentMethod";
ALTER TABLE "Quote" RENAME COLUMN "paymentMethod_new" TO "paymentMethod";

ALTER TABLE "Quote" ADD COLUMN "payoutMethod_new" "PayoutMethod";
UPDATE "Quote" SET "payoutMethod_new" = CASE
  WHEN "payoutMethod" IN ('MOMO', 'ORANGE', 'BANK', 'CRYPTO') THEN "payoutMethod"::"PayoutMethod"
  ELSE 'MOMO'::"PayoutMethod"
END;
ALTER TABLE "Quote" DROP COLUMN "payoutMethod";
ALTER TABLE "Quote" RENAME COLUMN "payoutMethod_new" TO "payoutMethod";

-- Make new columns non-nullable and ensure default where needed
ALTER TABLE "Quote" ALTER COLUMN "flow" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "paymentMethod" SET NOT NULL;
ALTER TABLE "Quote" ALTER COLUMN "payoutMethod" SET NOT NULL;
