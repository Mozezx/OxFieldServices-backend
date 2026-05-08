/*
  Warnings:

  - You are about to drop the `AIWalkthrough` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `BeforeAfterComparison` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CompanyShowcase` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `DigitalSignature` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PhaseChecklist` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PhaseTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectDocument` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectGalleryLink` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectReport` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ProjectTemplate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReviewRequest` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ShowcaseItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubcontractorInvite` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WebhookDelivery` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WebhookEndpoint` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AIWalkthrough" DROP CONSTRAINT "AIWalkthrough_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "AIWalkthrough" DROP CONSTRAINT "AIWalkthrough_projectId_fkey";

-- DropForeignKey
ALTER TABLE "BeforeAfterComparison" DROP CONSTRAINT "BeforeAfterComparison_projectId_fkey";

-- DropForeignKey
ALTER TABLE "CompanyShowcase" DROP CONSTRAINT "CompanyShowcase_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "DigitalSignature" DROP CONSTRAINT "DigitalSignature_signerId_fkey";

-- DropForeignKey
ALTER TABLE "PhaseChecklist" DROP CONSTRAINT "PhaseChecklist_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "PhaseTemplate" DROP CONSTRAINT "PhaseTemplate_templateId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectDocument" DROP CONSTRAINT "ProjectDocument_phaseId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectDocument" DROP CONSTRAINT "ProjectDocument_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectGalleryLink" DROP CONSTRAINT "ProjectGalleryLink_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectReport" DROP CONSTRAINT "ProjectReport_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectReport" DROP CONSTRAINT "ProjectReport_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ProjectTemplate" DROP CONSTRAINT "ProjectTemplate_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewRequest" DROP CONSTRAINT "ReviewRequest_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ReviewRequest" DROP CONSTRAINT "ReviewRequest_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ShowcaseItem" DROP CONSTRAINT "ShowcaseItem_projectId_fkey";

-- DropForeignKey
ALTER TABLE "ShowcaseItem" DROP CONSTRAINT "ShowcaseItem_showcaseId_fkey";

-- DropForeignKey
ALTER TABLE "SubcontractorInvite" DROP CONSTRAINT "SubcontractorInvite_projectId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookDelivery" DROP CONSTRAINT "WebhookDelivery_endpointId_fkey";

-- DropForeignKey
ALTER TABLE "WebhookEndpoint" DROP CONSTRAINT "WebhookEndpoint_organizationId_fkey";

-- DropTable
DROP TABLE "AIWalkthrough";

-- DropTable
DROP TABLE "BeforeAfterComparison";

-- DropTable
DROP TABLE "CompanyShowcase";

-- DropTable
DROP TABLE "DigitalSignature";

-- DropTable
DROP TABLE "PhaseChecklist";

-- DropTable
DROP TABLE "PhaseTemplate";

-- DropTable
DROP TABLE "ProjectDocument";

-- DropTable
DROP TABLE "ProjectGalleryLink";

-- DropTable
DROP TABLE "ProjectReport";

-- DropTable
DROP TABLE "ProjectTemplate";

-- DropTable
DROP TABLE "ReviewRequest";

-- DropTable
DROP TABLE "ShowcaseItem";

-- DropTable
DROP TABLE "SubcontractorInvite";

-- DropTable
DROP TABLE "WebhookDelivery";

-- DropTable
DROP TABLE "WebhookEndpoint";

-- DropEnum
DROP TYPE "DocumentType";

-- DropEnum
DROP TYPE "ReportType";

-- DropEnum
DROP TYPE "ReviewStatus";

-- DropEnum
DROP TYPE "SignatureTarget";

-- DropEnum
DROP TYPE "WalkthroughStatus";
