-- AlterTable
ALTER TABLE "open_po_lines" ADD COLUMN     "amount" DECIMAL(14,2),
ADD COLUMN     "unit_price" DECIMAL(14,4);
