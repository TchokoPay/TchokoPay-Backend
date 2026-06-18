-- Merchant settlement fee policy (flow = WITHDRAWAL), decided by HOW the payer paid:
--   - Payer pays in XAF via MTN MoMo  -> 3.5%
--   - Payer pays in XAF via Orange    -> 3.5%
--   - Anything else (incl. XAF via card, or any other currency) -> 10% (catch-all)
-- A NULL field means "any". Highest priority wins.
-- The fee is applied to the merchant's settlement before it reaches their wallet.
-- Idempotent: clears existing WITHDRAWAL rules, then re-inserts the canonical set.
DELETE FROM "FeeConfig" WHERE flow = 'WITHDRAWAL';

INSERT INTO "FeeConfig"
  (id, "baseCurrencyCode", "paymentMethod", flow, "feePercent", "spreadPercent", "isActive", priority, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'XAF', 'MOMO',   'WITHDRAWAL', 3.5, 0, true, 20, now(), now()),
  (gen_random_uuid(), 'XAF', 'ORANGE', 'WITHDRAWAL', 3.5, 0, true, 20, now(), now());

INSERT INTO "FeeConfig"
  (id, flow, "feePercent", "spreadPercent", "isActive", priority, "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'WITHDRAWAL', 10, 0, true, 0, now(), now());
