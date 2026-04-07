/*
  Warnings:

  - You are about to drop the column `flow` on the `Quote` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Quote" DROP COLUMN "flow",
ADD COLUMN     "exchangeRate" DECIMAL(65,30),
ADD COLUMN     "fee" DECIMAL(65,30),
ADD COLUMN     "rateSource" TEXT;
