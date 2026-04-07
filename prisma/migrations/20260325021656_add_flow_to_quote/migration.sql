/*
  Warnings:

  - Added the required column `flow` to the `Quote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "flow" "PaymentFlow" NOT NULL DEFAULT 'DIRECT';
