-- CreateTable
CREATE TABLE "UserPaymentPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultPaymentMethod" TEXT NOT NULL DEFAULT 'MOMO',
    "defaultPayoutMethod" TEXT NOT NULL DEFAULT 'MOMO',
    "autoRefund" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPaymentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPaymentPhoneSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPaymentPhoneSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPaymentPhoneVerificationCode" (
    "id" TEXT NOT NULL,
    "phoneSettingId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPaymentPhoneVerificationCode_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "PaymentInvoice"
ADD COLUMN "payoutProviderCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserPaymentPreference_userId_key" ON "UserPaymentPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPaymentPhoneSettings_phone_key" ON "UserPaymentPhoneSettings"("phone");

-- CreateIndex
CREATE INDEX "UserPaymentPhoneSettings_userId_idx" ON "UserPaymentPhoneSettings"("userId");

-- CreateIndex
CREATE INDEX "UserPaymentPhoneSettings_countryId_idx" ON "UserPaymentPhoneSettings"("countryId");

-- CreateIndex
CREATE INDEX "UserPaymentPhoneSettings_providerId_idx" ON "UserPaymentPhoneSettings"("providerId");

-- CreateIndex
CREATE INDEX "UserPaymentPhoneVerificationCode_phoneSettingId_idx" ON "UserPaymentPhoneVerificationCode"("phoneSettingId");

-- AddForeignKey
ALTER TABLE "UserPaymentPreference"
ADD CONSTRAINT "UserPaymentPreference_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPaymentPhoneSettings"
ADD CONSTRAINT "UserPaymentPhoneSettings_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPaymentPhoneSettings"
ADD CONSTRAINT "UserPaymentPhoneSettings_countryId_fkey"
FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPaymentPhoneSettings"
ADD CONSTRAINT "UserPaymentPhoneSettings_providerId_fkey"
FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPaymentPhoneVerificationCode"
ADD CONSTRAINT "UserPaymentPhoneVerificationCode_phoneSettingId_fkey"
FOREIGN KEY ("phoneSettingId") REFERENCES "UserPaymentPhoneSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
