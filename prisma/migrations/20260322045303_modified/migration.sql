-- CreateTable
CREATE TABLE "FeeConfig" (
    "id" TEXT NOT NULL,
    "baseCurrencyCode" TEXT,
    "targetCurrencyCode" TEXT,
    "paymentMethod" TEXT,
    "flow" TEXT,
    "feePercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "spreadPercent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeConfig_baseCurrencyCode_idx" ON "FeeConfig"("baseCurrencyCode");

-- CreateIndex
CREATE INDEX "FeeConfig_targetCurrencyCode_idx" ON "FeeConfig"("targetCurrencyCode");

-- CreateIndex
CREATE INDEX "FeeConfig_paymentMethod_idx" ON "FeeConfig"("paymentMethod");

-- CreateIndex
CREATE INDEX "FeeConfig_flow_idx" ON "FeeConfig"("flow");
