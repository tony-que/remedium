-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "due_date" DATE;

-- CreateTable
CREATE TABLE "payments" (
    "qbo_id" TEXT NOT NULL,
    "txn_date" DATE NOT NULL,
    "customer_qbo_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "total_amt" DECIMAL(14,2) NOT NULL,
    "unapplied_amt" DECIMAL(14,2) NOT NULL,
    "last_updated_qbo" TIMESTAMPTZ(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("qbo_id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" BIGSERIAL NOT NULL,
    "payment_qbo_id" TEXT NOT NULL,
    "line_num" INTEGER NOT NULL,
    "txn_type" TEXT NOT NULL,
    "txn_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_txn_date_idx" ON "payments"("txn_date");

-- CreateIndex
CREATE INDEX "payments_customer_qbo_id_idx" ON "payments"("customer_qbo_id");

-- CreateIndex
CREATE INDEX "payment_links_txn_type_txn_id_idx" ON "payment_links"("txn_type", "txn_id");

-- CreateIndex
CREATE INDEX "payment_links_payment_qbo_id_idx" ON "payment_links"("payment_qbo_id");

-- AddForeignKey
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_payment_qbo_id_fkey" FOREIGN KEY ("payment_qbo_id") REFERENCES "payments"("qbo_id") ON DELETE CASCADE ON UPDATE CASCADE;
