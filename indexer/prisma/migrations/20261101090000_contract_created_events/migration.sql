-- AlterTable
ALTER TABLE "ContractEventRecord" ADD COLUMN     "deployer" TEXT,
ADD COLUMN     "salt" TEXT,
ADD COLUMN     "wasmHash" TEXT;
