-- Adds product_line to sales_lines for the dashboard's product-line filter
-- (Wound Care, Skincare, Support Surfaces). The new column is appended last,
-- as CREATE OR REPLACE VIEW requires; every other column is unchanged.
CREATE OR REPLACE VIEW "sales_lines" AS
SELECT
  l."id"                                             AS line_id,
  l."doc_type"                                       AS doc_type,
  i."qbo_id"                                         AS invoice_qbo_id,
  i."doc_number"                                     AS doc_number,
  i."txn_date"                                       AS txn_date,
  date_trunc('month', i."txn_date")::date            AS month,
  i."customer_qbo_id"                                AS customer_qbo_id,
  COALESCE(c."display_name", i."customer_name", '(unknown customer)') AS customer_name,
  l."item_qbo_id"                                    AS item_qbo_id,
  COALESCE(it."sku", f.sku, '(no item)')            AS sku,
  COALESCE(it."base_sku", f.sku, '(no item)')       AS base_sku,
  it."category"                                      AS category,
  COALESCE(it."is_product", false)                   AS is_product,
  COALESCE(it."is_pack_variant", false)              AS is_pack_variant,
  l."description"                                    AS description,
  l."unit_price"                                     AS unit_price,
  CASE WHEN l."doc_type" = 'credit_memo' THEN -l."qty"    ELSE l."qty"    END AS qty,
  CASE WHEN l."doc_type" = 'credit_memo' THEN -l."amount" ELSE l."amount" END AS amount,
  sc."eaches_per_unit"                               AS eaches_per_unit,
  (sc."sku" IS NOT NULL)                             AS has_conversion,
  COALESCE(
    CASE WHEN l."doc_type" = 'credit_memo' THEN -l."qty" ELSE l."qty" END * sc."eaches_per_unit",
    0
  )::numeric(14, 2)                                  AS eaches,
  -- Product line, by SKU prefix (the same rule as productLineOf in
  -- lib/items.ts): REM or RH is Wound Care, SC is Skincare, any other product
  -- is Support Surfaces. Non-product lines belong to no line.
  CASE
    WHEN NOT COALESCE(it."is_product", false) THEN NULL
    WHEN upper(COALESCE(it."sku", f.sku, '')) ~ '^(REM|RH)' THEN 'wound'
    WHEN upper(COALESCE(it."sku", f.sku, '')) LIKE 'SC%' THEN 'skin'
    ELSE 'support'
  END                                                AS product_line
FROM "invoice_lines" l
JOIN "invoices" i
  ON i."doc_type" = l."doc_type" AND i."qbo_id" = l."invoice_qbo_id"
LEFT JOIN "customers" c       ON c."qbo_id" = i."customer_qbo_id"
LEFT JOIN "items" it          ON it."qbo_id" = l."item_qbo_id"
-- Fallback SKU from the line's own item name: its last ":" segment, trimmed.
CROSS JOIN LATERAL (
  SELECT NULLIF(btrim(regexp_replace(l."item_name", '^.*:', '')), '') AS sku
) f
LEFT JOIN "sku_conversions" sc ON sc."sku" = COALESCE(it."sku", f.sku)
WHERE NOT i."deleted";
