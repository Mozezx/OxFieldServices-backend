-- Quality Control: add under_review to PhaseStatus, inspector to UserRole, rejectionComment to ProjectPhase

-- 1. PhaseStatus: add under_review
ALTER TYPE "PhaseStatus" ADD VALUE IF NOT EXISTS 'under_review' AFTER 'in_progress';

-- 2. UserRole: add inspector
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'inspector';

-- 3. ProjectPhase: add rejectionComment column
ALTER TABLE "ProjectPhase" ADD COLUMN IF NOT EXISTS "rejectionComment" TEXT;
