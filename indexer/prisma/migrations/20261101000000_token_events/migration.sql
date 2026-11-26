-- CreateTable
CREATE TABLE "TokenEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tokenContractId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "spender" TEXT,
    "amount" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenEvent_eventId_key" ON "TokenEvent"("eventId");

-- CreateIndex
CREATE INDEX "TokenEvent_from_ledger_idx" ON "TokenEvent"("from", "ledger");

-- CreateIndex
CREATE INDEX "TokenEvent_to_ledger_idx" ON "TokenEvent"("to", "ledger");

-- CreateIndex
CREATE INDEX "TokenEvent_tokenContractId_ledger_idx" ON "TokenEvent"("tokenContractId", "ledger");
