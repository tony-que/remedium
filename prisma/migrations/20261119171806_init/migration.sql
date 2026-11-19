-- CreateEnum
CREATE TYPE "doc_type" AS ENUM ('invoice', 'credit_memo');

-- CreateEnum
CREATE TYPE "sync_kind" AS ENUM ('full', 'incremental');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "role" AS ENUM ('admin', 'viewer');

-- CreateTable
CREATE TABLE "invoices" (
    "doc_type" "doc_type" NOT NULL,
    "qbo_id" TEXT NOT NULL,
    "doc_number" TEXT,
    "txn_date" DATE NOT NULL,
    "customer_qbo_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "total_amt" DECIMAL(14,2) NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "last_updated_qbo" TIMESTAMPTZ(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("doc_type","qbo_id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" BIGSERIAL NOT NULL,
    "doc_type" "doc_type" NOT NULL,
    "invoice_qbo_id" TEXT NOT NULL,
    "line_num" INTEGER NOT NULL,
    "item_qbo_id" TEXT,
    "item_name" TEXT,
    "qty" DECIMAL(12,2) NOT NULL,
    "unit_price" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "qbo_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT,
    "base_sku" TEXT NOT NULL,
    "is_pack_variant" BOOLEAN NOT NULL DEFAULT false,
    "is_product" BOOLEAN NOT NULL DEFAULT true,
    "is_product_set_by_admin" BOOLEAN NOT NULL DEFAULT false,
    "item_type" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("qbo_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "qbo_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("qbo_id")
);

-- CreateTable
CREATE TABLE "sku_conversions" (
    "sku" TEXT NOT NULL,
    "eaches_per_unit" INTEGER NOT NULL,
    "note" TEXT,
    "updated_by" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_conversions_pkey" PRIMARY KEY ("sku")
);

-- CreateTable
CREATE TABLE "sync_runs" (
    "id" BIGSERIAL NOT NULL,
    "kind" "sync_kind" NOT NULL,
    "status" "sync_status" NOT NULL DEFAULT 'running',
    "triggered_by" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "invoices_upserted" INTEGER NOT NULL DEFAULT 0,
    "invoices_deleted" INTEGER NOT NULL DEFAULT 0,
    "items_upserted" INTEGER NOT NULL DEFAULT 0,
    "customers_upserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allowed_users" (
    "email" TEXT NOT NULL,
    "role" "role" NOT NULL DEFAULT 'viewer',
    "added_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allowed_users_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "qbo_connection" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "realm_id" TEXT NOT NULL,
    "access_token_enc" TEXT NOT NULL,
    "refresh_token_enc" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "refresh_token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "connected_by" TEXT NOT NULL,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "qbo_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_txn_date_idx" ON "invoices"("txn_date");

-- CreateIndex
CREATE INDEX "invoices_customer_qbo_id_idx" ON "invoices"("customer_qbo_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_qbo_id_idx" ON "invoice_lines"("invoice_qbo_id");

-- CreateIndex
CREATE INDEX "invoice_lines_item_qbo_id_idx" ON "invoice_lines"("item_qbo_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_doc_type_invoice_qbo_id_line_num_key" ON "invoice_lines"("doc_type", "invoice_qbo_id", "line_num");

-- CreateIndex
CREATE INDEX "items_sku_idx" ON "items"("sku");

-- CreateIndex
CREATE INDEX "items_base_sku_idx" ON "items"("base_sku");

-- CreateIndex
CREATE INDEX "sync_runs_started_at_idx" ON "sync_runs"("started_at");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at");

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_doc_type_invoice_qbo_id_fkey" FOREIGN KEY ("doc_type", "invoice_qbo_id") REFERENCES "invoices"("doc_type", "qbo_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written SQL that Prisma's schema language can't express.
-- ---------------------------------------------------------------------------

-- Emails on the allow-list are stored lowercase so lookups are exact.
ALTER TABLE "allowed_users"
  ADD CONSTRAINT "allowed_users_email_lowercase" CHECK ("email" = lower("email"));

-- There is exactly one QuickBooks connection row.
ALTER TABLE "qbo_connection"
  ADD CONSTRAINT "qbo_connection_singleton" CHECK ("id" = 1);

ALTER TABLE "sku_conversions"
  ADD CONSTRAINT "sku_conversions_eaches_nonnegative" CHECK ("eaches_per_unit" >= 0);

-- Sync lock: at most one run may be in the 'running' state at a time.
CREATE UNIQUE INDEX "sync_runs_one_running"
  ON "sync_runs" ((true)) WHERE "status" = 'running';

-- ---------------------------------------------------------------------------
-- sales_lines: the flat shape every dashboard query reads.
--
-- * Deleted invoices and credit memos are left out.
-- * Credit memo lines come back with qty, amount and eaches made negative,
--   so every SUM nets them out automatically.
-- * eaches = qty x eaches_per_unit for the item's own SKU; a SKU with no
--   conversion row has eaches_per_unit NULL and eaches 0 (has_conversion
--   tells the dashboard to warn about it).
-- * Lines whose item is missing from items keep the name QuickBooks sent and
--   count as non-product until the next item sync fills them in.
-- ---------------------------------------------------------------------------
CREATE VIEW "sales_lines" AS
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
  COALESCE(it."sku", l."item_name", '(no item)')     AS sku,
  COALESCE(it."base_sku", it."sku", l."item_name", '(no item)') AS base_sku,
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
  )::numeric(14, 2)                                  AS eaches
FROM "invoice_lines" l
JOIN "invoices" i
  ON i."doc_type" = l."doc_type" AND i."qbo_id" = l."invoice_qbo_id"
LEFT JOIN "customers" c       ON c."qbo_id" = i."customer_qbo_id"
LEFT JOIN "items" it          ON it."qbo_id" = l."item_qbo_id"
LEFT JOIN "sku_conversions" sc ON sc."sku" = COALESCE(it."sku", l."item_name")
WHERE NOT i."deleted";
