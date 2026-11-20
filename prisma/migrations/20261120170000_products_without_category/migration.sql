-- Items with no QuickBooks category (for example HOMECARE MATTRESS) now count
-- as products, unless they are one of the named non-product items. This
-- brings existing rows in line with the new rule in lib/items.ts right away,
-- instead of waiting for the next sync. Flags an admin set by hand are kept.
UPDATE "items"
SET "is_product" = true
WHERE "category" IS NULL
  AND NOT "is_product"
  AND NOT "is_product_set_by_admin"
  AND lower(btrim("sku")) NOT IN (
    'product partnership and profit share services',
    'shipping',
    'research and development',
    'discount'
  );
