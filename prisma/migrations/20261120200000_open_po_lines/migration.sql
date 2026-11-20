-- CreateTable
CREATE TABLE "open_po_lines" (
    "po_qbo_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "item_qbo_id" TEXT NOT NULL,
    "doc_number" TEXT,
    "vendor" TEXT,
    "txn_date" DATE NOT NULL,
    "expected_date" DATE,
    "qty_ordered" DECIMAL(14,2) NOT NULL,
    "qty_remaining" DECIMAL(14,2) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "open_po_lines_pkey" PRIMARY KEY ("po_qbo_id","line_id")
);

-- CreateIndex
CREATE INDEX "open_po_lines_sku_idx" ON "open_po_lines"("sku");
