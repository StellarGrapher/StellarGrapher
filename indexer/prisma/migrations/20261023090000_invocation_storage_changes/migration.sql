-- CreateTable
CREATE TABLE "InvocationStorageChange" (
    "id" TEXT NOT NULL,
    "invocationId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "durability" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueBefore" TEXT,
    "valueAfter" TEXT,
    "ledger" INTEGER NOT NULL,
    "txHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvocationStorageChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvocationStorageChange_invocationId_key_durability_key" ON "InvocationStorageChange"("invocationId", "key", "durability");

-- CreateIndex
CREATE INDEX "InvocationStorageChange_invocationId_idx" ON "InvocationStorageChange"("invocationId");

-- CreateIndex
CREATE INDEX "InvocationStorageChange_contractId_ledger_idx" ON "InvocationStorageChange"("contractId", "ledger");
