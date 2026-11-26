-- Backwards-compatible: nullable column, existing rows keep NULL until the
-- indexer observes the contract instance entry's TTL.
ALTER TABLE "Contract"
ADD COLUMN "expiresAtLedger" INTEGER;
