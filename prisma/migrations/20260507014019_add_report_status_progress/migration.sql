-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "ProjectReport" ADD COLUMN     "progress" INTEGER,
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "fileUrl" SET DEFAULT '';
