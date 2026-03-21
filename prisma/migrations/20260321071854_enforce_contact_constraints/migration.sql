/*
  Warnings:

  - A unique constraint covering the columns `[userId,type]` on the table `UserContact` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[value]` on the table `UserContact` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "UserContact_type_value_key";

-- CreateIndex
CREATE UNIQUE INDEX "UserContact_userId_type_key" ON "UserContact"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "UserContact_value_key" ON "UserContact"("value");
