-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpCode_scope_subjectId_idx" ON "OtpCode"("scope", "subjectId");

-- CreateIndex
CREATE INDEX "OtpCode_destination_idx" ON "OtpCode"("destination");

-- Migrate user contact OTPs into unified OTP storage
INSERT INTO "OtpCode" ("id", "scope", "subjectId", "channel", "destination", "code", "expiresAt", "createdAt")
SELECT
  vc."id",
  'USER_CONTACT',
  vc."contactId",
  uc."type"::TEXT,
  COALESCE(uc."pendingValue", uc."value"),
  vc."code",
  vc."expiresAt",
  vc."createdAt"
FROM "VerificationCode" vc
JOIN "UserContact" uc ON uc."id" = vc."contactId";

-- Migrate payout-setting OTPs into unified OTP storage
INSERT INTO "OtpCode" ("id", "scope", "subjectId", "channel", "destination", "code", "expiresAt", "createdAt")
SELECT
  upvc."id",
  'PAYOUT_SETTING',
  upvc."phoneSettingId",
  'PHONE',
  upps."phone",
  upvc."code",
  upvc."expiresAt",
  upvc."createdAt"
FROM "UserPaymentPhoneVerificationCode" upvc
JOIN "UserPaymentPhoneSettings" upps ON upps."id" = upvc."phoneSettingId";

-- DropForeignKey
ALTER TABLE "VerificationCode" DROP CONSTRAINT "VerificationCode_contactId_fkey";

-- DropForeignKey
ALTER TABLE "UserPaymentPhoneVerificationCode" DROP CONSTRAINT "UserPaymentPhoneVerificationCode_phoneSettingId_fkey";

-- DropTable
DROP TABLE "VerificationCode";

-- DropTable
DROP TABLE "UserPaymentPhoneVerificationCode";
