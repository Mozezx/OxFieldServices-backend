-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workerVisibleLabelIds" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "ProjectChecklist" ALTER COLUMN "updatedAt" DROP DEFAULT;
