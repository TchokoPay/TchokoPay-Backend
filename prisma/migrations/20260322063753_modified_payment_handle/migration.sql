/*
  Warnings:

  - You are about to drop the column `paymentId` on the `PaymentIdentity` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[handle]` on the table `PaymentIdentity` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `handle` to the `PaymentIdentity` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PaymentIdentity_paymentId_idx";

-- DropIndex
DROP INDEX "PaymentIdentity_paymentId_key";

-- AlterTable
ALTER TABLE "PaymentIdentity" DROP COLUMN "paymentId",
ADD COLUMN     "handle" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIdentity_handle_key" ON "PaymentIdentity"("handle");

-- CreateIndex
CREATE INDEX "PaymentIdentity_handle_idx" ON "PaymentIdentity"("handle");
