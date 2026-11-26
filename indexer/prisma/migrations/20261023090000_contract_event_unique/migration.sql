-- Add eventIndex column (default 0 for existing rows)
ALTER TABLE "ContractEventRecord" ADD COLUMN "eventIndex" INTEGER NOT NULL DEFAULT 0;

-- Backfill eventIndex from the eventId suffix ("<txHash>-<opIndex>-<eventIndex>")
UPDATE "ContractEventRecord"
SET "eventIndex" = COALESCE(
  NULLIF(substring("eventId" from '([0-9]+)$'), '')::INTEGER,
  0
);

-- CreateIndex
CREATE INDEX "ContractEventRecord_contractId_ledger_eventIndex_idx" ON "ContractEventRecord"("contractId", "ledger", "eventIndex");
