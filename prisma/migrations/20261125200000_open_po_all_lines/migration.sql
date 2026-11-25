-- AlterTable
ALTER TABLE "open_po_lines" ADD COLUMN     "counted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "item_name" TEXT,
ADD COLUMN     "open_amount" DECIMAL(14,2),
ALTER COLUMN "sku" DROP NOT NULL,
ALTER COLUMN "item_qbo_id" DROP NOT NULL,
ALTER COLUMN "qty_ordered" DROP NOT NULL,
ALTER COLUMN "qty_remaining" DROP NOT NULL;

-- Rows from before this change were all stock-tracked lines.
UPDATE "open_po_lines" SET "counted" = true, "open_amount" = round("unit_price" * "qty_remaining", 2);
