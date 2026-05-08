-- CreateIndex
CREATE INDEX "PhaseEvidence_phaseId_uploadedAt_idx" ON "PhaseEvidence"("phaseId", "uploadedAt");

-- CreateIndex
CREATE INDEX "Project_status_organizationId_idx" ON "Project"("status", "organizationId");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "project_assignments_workerId_removedAt_idx" ON "project_assignments"("workerId", "removedAt");
