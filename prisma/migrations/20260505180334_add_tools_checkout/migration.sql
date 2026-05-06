-- CreateEnum
CREATE TYPE "ToolCheckoutStatus" AS ENUM ('CHECKED_OUT', 'RETURNED');

-- CreateTable
CREATE TABLE "ToolCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tool" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolCheckout" (
    "id" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "checkedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "status" "ToolCheckoutStatus" NOT NULL DEFAULT 'CHECKED_OUT',

    CONSTRAINT "ToolCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolCheckout_toolId_status_idx" ON "ToolCheckout"("toolId", "status");

-- CreateIndex
CREATE INDEX "ToolCheckout_workerId_status_idx" ON "ToolCheckout"("workerId", "status");

-- AddForeignKey
ALTER TABLE "Tool" ADD CONSTRAINT "Tool_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ToolCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCheckout" ADD CONSTRAINT "ToolCheckout_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolCheckout" ADD CONSTRAINT "ToolCheckout_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
