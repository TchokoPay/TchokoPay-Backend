-- DropForeignKey
ALTER TABLE "PaymentInvoice" DROP CONSTRAINT "PaymentInvoice_recipientId_fkey";

-- AlterTable
ALTER TABLE "PaymentInvoice" ALTER COLUMN "recipientId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PaymentInvoice" ADD CONSTRAINT "PaymentInvoice_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
