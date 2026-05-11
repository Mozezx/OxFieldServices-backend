-- CreateTable
CREATE TABLE "capture_items" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "rawInput" TEXT,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capture_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capture_items_orgId_createdAt_idx" ON "capture_items"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "capture_items" ADD CONSTRAINT "capture_items_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
