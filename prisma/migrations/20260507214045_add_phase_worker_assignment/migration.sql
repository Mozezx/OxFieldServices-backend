-- AlterTable
ALTER TABLE "ProjectPhase" ADD COLUMN     "assignedWorkerId" TEXT;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_assignedWorkerId_fkey" FOREIGN KEY ("assignedWorkerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
