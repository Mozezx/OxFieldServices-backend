-- AlterEnum
ALTER TYPE "ToolCheckoutStatus" ADD VALUE 'RETURN_PENDING';

-- AlterTable
ALTER TABLE "ToolCheckout" ADD COLUMN     "returnRequestedAt" TIMESTAMP(3);
