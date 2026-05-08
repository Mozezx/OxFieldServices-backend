-- CreateTable
CREATE TABLE "WorkerLocation" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkerLocation_workerId_key" ON "WorkerLocation"("workerId");

-- AddForeignKey
ALTER TABLE "WorkerLocation" ADD CONSTRAINT "WorkerLocation_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
