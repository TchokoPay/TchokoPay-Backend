-- AlterTable
ALTER TABLE "PaymentProvider" ADD COLUMN     "aggregatorId" TEXT;

-- CreateTable
CREATE TABLE "PaymentAggregator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAggregator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAggregator_code_key" ON "PaymentAggregator"("code");

-- CreateIndex
CREATE INDEX "PaymentAggregator_code_idx" ON "PaymentAggregator"("code");

-- CreateIndex
CREATE INDEX "PaymentProvider_aggregatorId_idx" ON "PaymentProvider"("aggregatorId");

-- CreateIndex
CREATE INDEX "PaymentProvider_countryId_idx" ON "PaymentProvider"("countryId");

-- AddForeignKey
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_aggregatorId_fkey" FOREIGN KEY ("aggregatorId") REFERENCES "PaymentAggregator"("id") ON DELETE SET NULL ON UPDATE CASCADE;
