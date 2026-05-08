/*
  Warnings:

  - The required column `publicLinkNonce` was added to the `Project` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'phase_client_commented';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "publicLinkNonce" TEXT;
UPDATE "Project" SET "publicLinkNonce" = gen_random_uuid()::text WHERE "publicLinkNonce" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "publicLinkNonce" SET NOT NULL;

-- CreateTable
CREATE TABLE "phase_comments" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phase_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phase_comments_phaseId_idx" ON "phase_comments"("phaseId");

-- AddForeignKey
ALTER TABLE "phase_comments" ADD CONSTRAINT "phase_comments_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
