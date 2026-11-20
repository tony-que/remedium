-- Inventory now comes from QuickBooks quantity on hand instead of Orderwerks.
-- Any stock rows (there were none in production) are cleared; the next
-- inventory sync fills the table from QuickBooks items.
TRUNCATE "inventory_levels";

-- RenameColumn
ALTER TABLE "inventory_levels" RENAME COLUMN "catalog_item_guid" TO "item_qbo_id";
