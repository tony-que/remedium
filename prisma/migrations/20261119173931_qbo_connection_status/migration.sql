/*
  Warnings:

  - Added the required column `environment` to the `qbo_connection` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "qbo_connection" ADD COLUMN     "company_name" TEXT,
ADD COLUMN     "environment" TEXT NOT NULL,
ADD COLUMN     "last_refresh_error" TEXT,
ADD COLUMN     "last_refreshed_at" TIMESTAMPTZ(3);
