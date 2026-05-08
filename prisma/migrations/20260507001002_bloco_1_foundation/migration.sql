-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('FULL', 'DAILY_LOG', 'PHASE_SUMMARY', 'PAYMENT_SUMMARY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONTRACT', 'RECEIPT', 'BLUEPRINT', 'WORK_ORDER', 'INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SignatureTarget" AS ENUM ('PHASE_VALIDATION', 'CONTRACT', 'PROJECT_REPORT', 'INSPECTION');

-- CreateEnum
CREATE TYPE "WalkthroughStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SENT', 'CLICKED', 'DISMISSED');

-- AlterTable
ALTER TABLE "PhaseEvidence" ADD COLUMN     "aiCaption" TEXT,
ADD COLUMN     "annotationData" JSONB,
ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "gpsAccuracy" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "EvidenceComment" (
    "id" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "voiceUrl" TEXT,
    "transcript" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "ReportType" NOT NULL DEFAULT 'FULL',

    CONSTRAINT "ProjectReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectGalleryLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectGalleryLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseChecklist" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhaseChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ocrText" TEXT,

    CONSTRAINT "ProjectDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigitalSignature" (
    "id" TEXT NOT NULL,
    "signatureData" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerId" TEXT,
    "signerRole" TEXT NOT NULL,
    "entityType" "SignatureTarget" NOT NULL,
    "entityId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhaseTemplate" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "description" TEXT,
    "checklist" JSONB,

    CONSTRAINT "PhaseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubcontractorInvite" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseIds" TEXT[],
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usedAt" TIMESTAMP(3),
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubcontractorInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIWalkthrough" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "audioUrl" TEXT NOT NULL,
    "transcript" TEXT,
    "sections" JSONB,
    "checklist" JSONB,
    "summary" TEXT,
    "status" "WalkthroughStatus" NOT NULL DEFAULT 'PROCESSING',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AIWalkthrough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeforeAfterComparison" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "beforeUrl" TEXT NOT NULL,
    "afterUrl" TEXT NOT NULL,
    "title" TEXT,
    "exportUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeforeAfterComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyShowcase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logoUrl" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyShowcase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowcaseItem" (
    "id" TEXT NOT NULL,
    "showcaseId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "selectedPhotoUrls" TEXT[],
    "location" JSONB,
    "completedAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL,

    CONSTRAINT "ShowcaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "reviewUrl" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "status" "ReviewStatus" NOT NULL DEFAULT 'SENT',

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "statusCode" INTEGER,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceComment_evidenceId_idx" ON "EvidenceComment"("evidenceId");

-- CreateIndex
CREATE INDEX "ProjectReport_organizationId_idx" ON "ProjectReport"("organizationId");

-- CreateIndex
CREATE INDEX "ProjectReport_projectId_idx" ON "ProjectReport"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectGalleryLink_token_key" ON "ProjectGalleryLink"("token");

-- CreateIndex
CREATE INDEX "ProjectDocument_projectId_idx" ON "ProjectDocument"("projectId");

-- CreateIndex
CREATE INDEX "DigitalSignature_entityType_entityId_idx" ON "DigitalSignature"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ProjectTemplate_organizationId_idx" ON "ProjectTemplate"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "SubcontractorInvite_token_key" ON "SubcontractorInvite"("token");

-- CreateIndex
CREATE INDEX "SubcontractorInvite_projectId_idx" ON "SubcontractorInvite"("projectId");

-- CreateIndex
CREATE INDEX "AIWalkthrough_projectId_idx" ON "AIWalkthrough"("projectId");

-- CreateIndex
CREATE INDEX "BeforeAfterComparison_projectId_idx" ON "BeforeAfterComparison"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyShowcase_organizationId_key" ON "CompanyShowcase"("organizationId");

-- CreateIndex
CREATE INDEX "ShowcaseItem_showcaseId_idx" ON "ShowcaseItem"("showcaseId");

-- CreateIndex
CREATE INDEX "ReviewRequest_projectId_idx" ON "ReviewRequest"("projectId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_idx" ON "WebhookEndpoint"("organizationId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_idx" ON "WebhookDelivery"("endpointId");

-- AddForeignKey
ALTER TABLE "EvidenceComment" ADD CONSTRAINT "EvidenceComment_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PhaseEvidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceComment" ADD CONSTRAINT "EvidenceComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReport" ADD CONSTRAINT "ProjectReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectGalleryLink" ADD CONSTRAINT "ProjectGalleryLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseChecklist" ADD CONSTRAINT "PhaseChecklist_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDocument" ADD CONSTRAINT "ProjectDocument_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DigitalSignature" ADD CONSTRAINT "DigitalSignature_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTemplate" ADD CONSTRAINT "ProjectTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhaseTemplate" ADD CONSTRAINT "PhaseTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProjectTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubcontractorInvite" ADD CONSTRAINT "SubcontractorInvite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIWalkthrough" ADD CONSTRAINT "AIWalkthrough_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIWalkthrough" ADD CONSTRAINT "AIWalkthrough_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterComparison" ADD CONSTRAINT "BeforeAfterComparison_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyShowcase" ADD CONSTRAINT "CompanyShowcase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseItem" ADD CONSTRAINT "ShowcaseItem_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "CompanyShowcase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowcaseItem" ADD CONSTRAINT "ShowcaseItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
