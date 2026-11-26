-- Key storage changes by their position in the transaction's meta instead of
-- their decoded content, so reprocessing a transaction after a restart maps
-- onto the same rows and skipDuplicates can ignore them.
ALTER TABLE "StorageChange" ADD COLUMN "changeIndex" INTEGER;

-- Backfill existing rows: number each transaction's changes in insertion order.
WITH numbered AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "txHash" ORDER BY "createdAt", "id") - 1 AS "changeIndex"
    FROM "StorageChange"
)
UPDATE "StorageChange" AS sc
SET "changeIndex" = numbered."changeIndex"
FROM numbered
WHERE sc."id" = numbered."id";

ALTER TABLE "StorageChange" ALTER COLUMN "changeIndex" SET NOT NULL;

-- DropIndex
DROP INDEX "StorageChange_txHash_contractId_keyDisplay_durability_chang_key";

-- CreateIndex
CREATE UNIQUE INDEX "StorageChange_txHash_changeIndex_key" ON "StorageChange"("txHash", "changeIndex");
