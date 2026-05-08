-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'phase_client_commented';

-- AlterTable: publicLinkNonce com fallback para rows existentes
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "publicLinkNonce" TEXT;
UPDATE "Project" SET "publicLinkNonce" = gen_random_uuid()::text WHERE "publicLinkNonce" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "publicLinkNonce" SET NOT NULL;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "publicPortalEmail" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "publicPortalIdentifiedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "publicPortalName" TEXT;

-- CreateTable: phase_comments
CREATE TABLE IF NOT EXISTS "phase_comments" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "phase_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProjectEvidence (evidências diretas no projeto, sem fase)
CREATE TABLE IF NOT EXISTS "ProjectEvidence" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3),
    "annotationData" JSONB,
    "aiCaption" TEXT,
    "note" TEXT,
    CONSTRAINT "ProjectEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProjectEvidenceComment
CREATE TABLE IF NOT EXISTS "ProjectEvidenceComment" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "voiceUrl" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectEvidenceComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ProjectChecklist (checklist no nível do projeto)
CREATE TABLE IF NOT EXISTS "ProjectChecklist" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "phase_comments_phaseId_idx" ON "phase_comments"("phaseId");
CREATE INDEX IF NOT EXISTS "ProjectEvidence_projectId_idx" ON "ProjectEvidence"("projectId");
CREATE INDEX IF NOT EXISTS "ProjectEvidenceComment_evidenceId_idx" ON "ProjectEvidenceComment"("evidenceId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectChecklist_projectId_key" ON "ProjectChecklist"("projectId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'phase_comments_phaseId_fkey') THEN
    ALTER TABLE "phase_comments" ADD CONSTRAINT "phase_comments_phaseId_fkey"
      FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectEvidence_projectId_fkey') THEN
    ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectEvidence_uploadedBy_fkey') THEN
    ALTER TABLE "ProjectEvidence" ADD CONSTRAINT "ProjectEvidence_uploadedBy_fkey"
      FOREIGN KEY ("uploadedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectEvidenceComment_evidenceId_fkey') THEN
    ALTER TABLE "ProjectEvidenceComment" ADD CONSTRAINT "ProjectEvidenceComment_evidenceId_fkey"
      FOREIGN KEY ("evidenceId") REFERENCES "ProjectEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectEvidenceComment_authorId_fkey') THEN
    ALTER TABLE "ProjectEvidenceComment" ADD CONSTRAINT "ProjectEvidenceComment_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectChecklist_projectId_fkey') THEN
    ALTER TABLE "ProjectChecklist" ADD CONSTRAINT "ProjectChecklist_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
