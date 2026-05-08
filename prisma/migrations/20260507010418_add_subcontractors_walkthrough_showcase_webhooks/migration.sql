-- CreateEnum
CREATE TYPE "WalkthroughStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SENT', 'CLICKED', 'DISMISSED');

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
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
