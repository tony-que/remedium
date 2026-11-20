-- Inventory dashboard: QuickBooks item cost, owner-provided monthly usage,
-- and stock levels synced from Orderwerks.

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "purchase_cost" DECIMAL(14,4);

-- CreateTable
CREATE TABLE "sku_usage" (
    "sku" TEXT NOT NULL,
    "monthly_units" DECIMAL(12,2) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_usage_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "sku" TEXT NOT NULL,
    "catalog_item_guid" TEXT NOT NULL,
    "name" TEXT,
    "qty_available" DECIMAL(14,2) NOT NULL,
    "qty_reserved" DECIMAL(14,2) NOT NULL,
    "qty_held" DECIMAL(14,2) NOT NULL,
    "qty_incoming" DECIMAL(14,2) NOT NULL,
    "qty_backordered" DECIMAL(14,2) NOT NULL,
    "min_qty_on_hand" DECIMAL(14,2),
    "source_updated_at" TIMESTAMPTZ(3),
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "inventory_sync_runs" (
    "id" BIGSERIAL NOT NULL,
    "status" "sync_status" NOT NULL DEFAULT 'running',
    "triggered_by" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "skus" INTEGER NOT NULL DEFAULT 0,
    "api_requests" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "error" TEXT,

    CONSTRAINT "inventory_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_sync_runs_started_at_idx" ON "inventory_sync_runs"("started_at");

-- One inventory sync at a time: at most one row may be running.
CREATE UNIQUE INDEX "inventory_sync_runs_one_running" ON "inventory_sync_runs" ((true)) WHERE "status" = 'running';
