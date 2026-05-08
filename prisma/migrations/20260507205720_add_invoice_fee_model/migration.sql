-- CreateEnum
CREATE TYPE "InvoiceFeeModel" AS ENUM ('PASS_THROUGH', 'ABSORBED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "feeModel" "InvoiceFeeModel" NOT NULL DEFAULT 'PASS_THROUGH';
