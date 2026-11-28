-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "deployerAccountId" TEXT;

-- CreateIndex
CREATE INDEX "Contract_deployerAccountId_idx" ON "Contract"("deployerAccountId");
