-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('lead_worker', 'field_worker', 'supervisor');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'worker_assigned_to_project';
ALTER TYPE "NotificationType" ADD VALUE 'worker_removed_from_project';

-- CreateTable
CREATE TABLE "project_assignments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL DEFAULT 'field_worker',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,

    CONSTRAINT "project_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_assignments_projectId_idx" ON "project_assignments"("projectId");

-- CreateIndex
CREATE INDEX "project_assignments_workerId_idx" ON "project_assignments"("workerId");

-- CreateIndex
CREATE INDEX "project_assignments_projectId_workerId_idx" ON "project_assignments"("projectId", "workerId");

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignments" ADD CONSTRAINT "project_assignments_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
