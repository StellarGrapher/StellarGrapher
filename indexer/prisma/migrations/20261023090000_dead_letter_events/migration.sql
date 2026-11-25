-- CreateTable
CREATE TABLE "DeadLetterEvent" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "ledger" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "envelopeXdr" TEXT NOT NULL,
    "resultMetaXdr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DeadLetterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeadLetterEvent_txHash_stage_key" ON "DeadLetterEvent"("txHash", "stage");

-- CreateIndex
CREATE INDEX "DeadLetterEvent_resolvedAt_createdAt_idx" ON "DeadLetterEvent"("resolvedAt", "createdAt");
