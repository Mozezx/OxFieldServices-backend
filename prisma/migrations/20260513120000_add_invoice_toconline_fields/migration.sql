-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "clientNif" TEXT,
ADD COLUMN     "clientAddress" TEXT,
ADD COLUMN     "toconlineClientId" TEXT,
ADD COLUMN     "toconlineDocId" TEXT,
ADD COLUMN     "toconlineDocNumber" TEXT,
ADD COLUMN     "toconlineStatus" TEXT,
ADD COLUMN     "toconlinePdfUrl" TEXT,
ADD COLUMN     "toconlineSentAt" TIMESTAMP(3);
