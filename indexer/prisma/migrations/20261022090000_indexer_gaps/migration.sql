-- CreateTable
CREATE TABLE "IndexerGap" (
    "id" TEXT NOT NULL,
    "fromLedger" INTEGER NOT NULL,
    "toLedger" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexerGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IndexerGap_fromLedger_idx" ON "IndexerGap"("fromLedger");

-- CreateTable
CREATE TABLE "WebhookDeadLetter" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "lastError" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_createdAt_idx" ON "WebhookDeadLetter"("createdAt");
