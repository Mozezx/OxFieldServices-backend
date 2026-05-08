-- CreateEnum
CREATE TYPE "WorkerAccessTier" AS ENUM ('standard', 'restricted');

-- AlterTable
ALTER TABLE "Worker" ADD COLUMN     "accessTier" "WorkerAccessTier" NOT NULL DEFAULT 'standard';
