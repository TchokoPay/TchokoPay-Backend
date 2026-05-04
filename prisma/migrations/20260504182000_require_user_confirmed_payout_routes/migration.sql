-- AlterTable
ALTER TABLE "UserPaymentPhoneSettings"
ADD COLUMN "isUserConfirmed" BOOLEAN NOT NULL DEFAULT true;

-- Legacy bootstrap rows came from verified auth contacts without explicit
-- provider choice. If a user has exactly one payout row and it matches their
-- verified phone contact, mark it as not user-confirmed so the app asks the
-- user to choose the provider explicitly.
UPDATE "UserPaymentPhoneSettings" ups
SET "isUserConfirmed" = false,
    "isPrimary" = false
WHERE EXISTS (
  SELECT 1
  FROM "UserContact" uc
  WHERE uc."userId" = ups."userId"
    AND uc."type" = 'PHONE'
    AND uc."isVerified" = true
    AND uc."value" = ups."phone"
)
AND (
  SELECT COUNT(*)
  FROM "UserPaymentPhoneSettings" ups2
  WHERE ups2."userId" = ups."userId"
) = 1;
