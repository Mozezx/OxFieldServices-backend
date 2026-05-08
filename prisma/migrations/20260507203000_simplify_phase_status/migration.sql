-- ETAPA 8 (PAYMENTS_PIVOT): PhaseStatus → pending | in_progress | completed

CREATE TYPE "PhaseStatus_new" AS ENUM ('pending', 'in_progress', 'completed');

ALTER TABLE "ProjectPhase" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "ProjectPhase" ALTER COLUMN "status" TYPE "PhaseStatus_new" USING (
  CASE ("status"::text)
    WHEN 'validated' THEN 'completed'::"PhaseStatus_new"
    WHEN 'pending' THEN 'pending'::"PhaseStatus_new"
    WHEN 'in_progress' THEN 'in_progress'::"PhaseStatus_new"
    WHEN 'evidence_uploaded' THEN 'in_progress'::"PhaseStatus_new"
    WHEN 'under_review' THEN 'in_progress'::"PhaseStatus_new"
    WHEN 'rejected' THEN 'in_progress'::"PhaseStatus_new"
    ELSE 'in_progress'::"PhaseStatus_new"
  END
);

DROP TYPE "PhaseStatus";

ALTER TYPE "PhaseStatus_new" RENAME TO "PhaseStatus";

ALTER TABLE "ProjectPhase" ALTER COLUMN "status" SET DEFAULT 'pending'::"PhaseStatus";
