-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hubspotCompanyId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "hubspotDealId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hubspotContactId" TEXT;

-- CreateTable
CREATE TABLE "hubspot_sync_logs" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubspot_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hubspot_sync_logs_entityType_entityId_idx" ON "hubspot_sync_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "hubspot_sync_logs_createdAt_idx" ON "hubspot_sync_logs"("createdAt");
