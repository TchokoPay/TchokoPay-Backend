/*
  Warnings:

  - You are about to drop the `_TransactionToUser` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_TransactionToUser" DROP CONSTRAINT "_TransactionToUser_A_fkey";

-- DropForeignKey
ALTER TABLE "_TransactionToUser" DROP CONSTRAINT "_TransactionToUser_B_fkey";

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "userId" TEXT;

-- DropTable
DROP TABLE "_TransactionToUser";

-- CreateIndex
CREATE INDEX "Transaction_userId_idx" ON "Transaction"("userId");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
