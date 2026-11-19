// Seeds the database.
//
//   npm run db:seed                  conversions + fake sales data
//   npm run db:seed -- --no-fake     conversions only
//
// * SKU conversions come from sku_eaches_conversion.csv. Existing rows are
//   never overwritten, so re-running the seed can't undo the admin's edits.
// * Fake sales data is for local work only. It is refused when
//   NODE_ENV=production, and every fake row has an id starting "seed-"
//   (real QuickBooks ids are numeric), so re-seeding replaces only fake rows.

import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { parseConversionsCsv } from "@/lib/conversions";
import { parseItemName } from "@/lib/items";

const CSV_PATH = path.join(__dirname, "..", "sku_eaches_conversion.csv");
const SEED_ACTOR = "seed: sku_eaches_conversion.csv";

async function seedConversions() {
  const rows = parseConversionsCsv(readFileSync(CSV_PATH, "utf8"));
  const result = await prisma.skuConversion.createMany({
    data: rows.map((r) => ({
      sku: r.sku,
      eachesPerUnit: r.eachesPerUnit,
      note: r.note,
      updatedBy: SEED_ACTOR,
    })),
    skipDuplicates: true,
  });
  const unconfirmed = rows.filter((r) => /please fill in/i.test(r.note ?? "")).length;
  console.log(
    `SKU conversions: ${rows.length} in CSV, ${result.count} added, ${rows.length - result.count} already present` +
      ` (${unconfirmed} marked "please fill in")`,
  );
}

// ---------------------------------------------------------------------------
// Fake sales data
// ---------------------------------------------------------------------------

const CUSTOMERS = [
  ["seed-cust-1", "Sample Regional Distribution Center"],
  ["seed-cust-2", "Example General Hospital"],
  ["seed-cust-3", "Demo Medical Supply Co"],
  ["seed-cust-4", "Placeholder Health System"],
  ["seed-cust-5", "Amazon (sample)"],
  ["seed-cust-6", "Test Long-Term Care Group"],
] as const;

// [id, QuickBooks fully qualified name, item type]
const ITEMS = [
  ["seed-item-1", "Wound Care Dressings:Silicone Foam Dressings:REMSF99B", "Inventory"],
  ["seed-item-2", "Wound Care Dressings:Silicone Foam Dressings:REMSF77B", "Inventory"],
  ["seed-item-3", "Wound Care Dressings:Silicone Foam Dressings:REMSF44B", "Inventory"],
  ["seed-item-4", "Wound Care Dressings:Gelling Fiber:REMFG45", "Inventory"],
  ["seed-item-5", "Skin Care:SkinCentry:SCAF1204", "Inventory"],
  ["seed-item-6", "Amazon:Wound Care:REMSF99B - AMZ", "Inventory"],
  ["seed-item-7", "Amazon:Skin Care:SCAF1003-3PK-AMZ", "Inventory"],
  // A product with no row in the conversion CSV, to exercise the warning.
  ["seed-item-8", "Wound Care Dressings:Samples:REMSAMPLEKIT", "NonInventory"],
  ["seed-item-9", "Freight:Shipping", "Service"],
  ["seed-item-10", "DISCOUNT", "Service"],
  ["seed-item-11", "Services:Product Partnership and Profit Share Services", "Service"],
] as const;

type ItemKey = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
/** [item, qty, unit price, description?] — amount is qty x price. */
type Line = [ItemKey, number, number, string?];

interface Doc {
  id: string;
  type: "invoice" | "credit_memo";
  number: string;
  date: string;
  customer: 1 | 2 | 3 | 4 | 5 | 6;
  lines: Line[];
  deleted?: boolean;
  voided?: boolean;
}

// About 20 invoices across 2025 and 2026 (so "vs last year" has something to
// compare), plus credit memos, a deleted invoice, a voided invoice and a $0
// sample line.
const DOCS: Doc[] = [
  { id: "seed-inv-01", type: "invoice", number: "S1001", date: "2025-02-11", customer: 1, lines: [[1, 400, 161], [3, 50, 98.5]] },
  { id: "seed-inv-02", type: "invoice", number: "S1002", date: "2025-03-20", customer: 2, lines: [[2, 40, 120], [9, 1, 85]] },
  { id: "seed-inv-03", type: "invoice", number: "S1003", date: "2025-05-07", customer: 3, lines: [[4, 30, 140], [5, 20, 72]] },
  { id: "seed-inv-04", type: "invoice", number: "S1004", date: "2025-06-15", customer: 1, lines: [[1, 600, 161], [10, 1, -250, "Volume discount"]] },
  { id: "seed-inv-05", type: "invoice", number: "S1005", date: "2025-08-02", customer: 5, lines: [[6, 120, 175], [7, 300, 21.99]] },
  { id: "seed-inv-06", type: "invoice", number: "S1006", date: "2025-10-28", customer: 4, lines: [[1, 80, 165], [2, 25, 122], [11, 1, 12000]] },
  { id: "seed-inv-07", type: "invoice", number: "S1007", date: "2026-01-09", customer: 1, lines: [[1, 700, 161], [3, 60, 98.5], [9, 1, 140]] },
  { id: "seed-inv-08", type: "invoice", number: "S1008", date: "2026-01-23", customer: 2, lines: [[2, 45, 120], [4, 10, 140]] },
  { id: "seed-inv-09", type: "invoice", number: "S1009", date: "2026-02-14", customer: 3, lines: [[5, 36, 72], [8, 2, 0, "Sample kit, no charge"]] },
  { id: "seed-inv-10", type: "invoice", number: "S1010", date: "2026-03-03", customer: 1, lines: [[1, 650, 161]] },
  { id: "seed-inv-11", type: "invoice", number: "S1011", date: "2026-03-27", customer: 5, lines: [[6, 150, 175], [7, 420, 21.99]] },
  { id: "seed-inv-12", type: "invoice", number: "S1012", date: "2026-04-18", customer: 4, lines: [[1, 90, 165], [3, 30, 99]] },
  { id: "seed-inv-13", type: "invoice", number: "S1013", date: "2026-05-06", customer: 6, lines: [[2, 20, 124], [4, 15, 142], [9, 1, 95]] },
  { id: "seed-inv-14", type: "invoice", number: "S1014", date: "2026-06-11", customer: 1, lines: [[1, 720, 161], [10, 1, -400, "Volume discount"]] },
  { id: "seed-inv-15", type: "invoice", number: "S1015", date: "2026-07-01", customer: 2, lines: [[2, 50, 120], [5, 24, 72]] },
  { id: "seed-inv-16", type: "invoice", number: "S1016", date: "2026-08-19", customer: 3, lines: [[4, 25, 140], [1, 20, 168]] },
  { id: "seed-inv-17", type: "invoice", number: "S1017", date: "2026-09-08", customer: 5, lines: [[6, 160, 175]] },
  { id: "seed-inv-18", type: "invoice", number: "S1018", date: "2026-10-14", customer: 1, lines: [[1, 680, 161], [3, 40, 98.5], [11, 1, 15000]] },
  { id: "seed-inv-19", type: "invoice", number: "S1019", date: "2026-11-03", customer: 6, lines: [[2, 18, 124], [8, 1, 0, "Replacement, no charge"]] },
  // Voided: QuickBooks returns zero quantities and amounts; it stays as zero rows.
  { id: "seed-inv-20", type: "invoice", number: "S1020", date: "2026-11-10", customer: 4, voided: true, lines: [[1, 0, 0, "Voided"]] },
  // Deleted in QuickBooks: kept in the table with deleted = true, hidden by the view.
  { id: "seed-inv-21", type: "invoice", number: "S1021", date: "2026-09-30", customer: 2, deleted: true, lines: [[1, 999, 161]] },
  // Credit memos: returned to the view as negative lines.
  { id: "seed-cm-01", type: "credit_memo", number: "CM-S01", date: "2026-03-12", customer: 1, lines: [[1, 2, 161, "Damaged in transit"]] },
  { id: "seed-cm-02", type: "credit_memo", number: "CM-S02", date: "2026-07-20", customer: 5, lines: [[6, 5, 175, "Customer return"]] },
];

const money = (n: number) => new Prisma.Decimal(n.toFixed(2));

async function seedFakeData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to load fake sales data with NODE_ENV=production. Use --no-fake.");
  }

  await prisma.$transaction(async (tx) => {
    // Remove earlier fake rows only (lines cascade with their invoice).
    await tx.invoice.deleteMany({ where: { qboId: { startsWith: "seed-" } } });
    await tx.item.deleteMany({ where: { qboId: { startsWith: "seed-" } } });
    await tx.customer.deleteMany({ where: { qboId: { startsWith: "seed-" } } });

    await tx.customer.createMany({
      data: CUSTOMERS.map(([qboId, displayName]) => ({ qboId, displayName })),
    });

    await tx.item.createMany({
      data: ITEMS.map(([qboId, fullName, itemType]) => {
        const p = parseItemName(fullName);
        return {
          qboId,
          fullName,
          sku: p.sku,
          category: p.category,
          baseSku: p.baseSku,
          isPackVariant: p.isPackVariant,
          isProduct: p.isProduct,
          itemType,
        };
      }),
    });

    for (const doc of DOCS) {
      const lineAmounts = doc.lines.map(([, qty, price]) => Math.round(qty * price * 100) / 100);
      const total = doc.voided ? 0 : lineAmounts.reduce((a, b) => a + b, 0);
      await tx.invoice.create({
        data: {
          docType: doc.type,
          qboId: doc.id,
          docNumber: doc.number,
          txnDate: new Date(`${doc.date}T00:00:00Z`),
          customerQboId: CUSTOMERS[doc.customer - 1][0],
          customerName: CUSTOMERS[doc.customer - 1][1],
          totalAmt: money(total),
          balance: money(doc.type === "invoice" && doc.date >= "2026-10-01" ? total : 0),
          lastUpdatedQbo: new Date(`${doc.date}T15:00:00Z`),
          deleted: doc.deleted ?? false,
          lines: {
            create: doc.lines.map(([item, qty, price, description], i) => ({
              lineNum: i + 1,
              itemQboId: ITEMS[item - 1][0],
              itemName: ITEMS[item - 1][1],
              qty: new Prisma.Decimal(qty),
              unitPrice: new Prisma.Decimal(price),
              amount: money(lineAmounts[i]),
              description: description ?? null,
            })),
          },
        },
      });
    }
  });

  const invoices = DOCS.filter((d) => d.type === "invoice").length;
  console.log(
    `Fake data: ${CUSTOMERS.length} customers, ${ITEMS.length} items, ${invoices} invoices, ` +
      `${DOCS.length - invoices} credit memos`,
  );
}

async function main() {
  const noFake = process.argv.includes("--no-fake");
  await seedConversions();
  if (!noFake) await seedFakeData();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
