-- Add eventIndex column (default 0 for existing rows)
ALTER TABLE "ContractEventRecord" ADD COLUMN "eventIndex" INTEGER NOT NULL DEFAULT 0;

-- Backfill eventIndex from the eventId suffix ("<txHash>-<opIndex>-<eventIndex>")
UPDATE "ContractEventRecord"
SET "eventIndex" = COALESCE(
  NULLIF(substring("eventId" from '([0-9]+)$'), '')::INTEGER,
  0
);

-- Remove duplicates, keeping the earliest row per (contractId, ledger, eventIndex)
DELETE FROM "ContractEventRecord" a
USING "ContractEventRecord" b
WHERE a."contractId" = b."contractId"
  AND a."ledger" = b."ledger"
  AND a."eventIndex" = b."eventIndex"
  AND (a."createdAt", a."id") > (b."createdAt", b."id");

-- CreateIndex
CREATE UNIQUE INDEX "ContractEventRecord_contractId_ledger_eventIndex_key" ON "ContractEventRecord"("contractId", "ledger", "eventIndex");
