-- AlterTable
ALTER TABLE "sync_runs" ADD COLUMN     "alerted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "api_requests" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT;
