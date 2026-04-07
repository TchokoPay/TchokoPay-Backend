-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "iso2" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethodRef" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PaymentMethodRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProvider" (
    "id" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "requiresType" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_iso2_key" ON "Country"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethodRef_code_key" ON "PaymentMethodRef"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProvider_providerCode_key" ON "PaymentProvider"("providerCode");

-- AddForeignKey
ALTER TABLE "Country" ADD CONSTRAINT "Country_currencyId_fkey" FOREIGN KEY ("currencyId") REFERENCES "Currency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProvider" ADD CONSTRAINT "PaymentProvider_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethodRef"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
