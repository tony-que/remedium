import { NextResponse, type NextRequest } from "next/server";
import { apiGate } from "@/lib/access";
import { csvCell, decimalCell, toCsv } from "@/lib/csv";
import { parseFilters, todayCentral } from "@/lib/metrics/filters";
import { byMonth, customerTable, flatLines, grid, skuTable } from "@/lib/metrics/queries";

export const dynamic = "force-dynamic";

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** CSV of one dashboard table, or of the flat line data, for the filters in the query string. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const gate = await apiGate("viewer");
  if (gate instanceof NextResponse) return gate;
  const { kind } = await params;
  const f = parseFilters(req.nextUrl.searchParams, todayCentral());
  let header: string[];
  let rows: string[][];

  switch (kind) {
    case "lines": {
      header = ["date", "type", "doc_number", "customer", "sku", "base_sku", "category", "is_product", "description", "qty", "unit_price", "amount", "eaches_per_unit", "eaches"];
      rows = (await flatLines(f)).map((l) => [
        csvCell(l.txnDate), csvCell(l.docType), csvCell(l.docNumber), csvCell(l.customer), csvCell(l.sku), csvCell(l.baseSku),
        csvCell(l.category), csvCell(l.isProduct), csvCell(l.description), decimalCell(l.qty), decimalCell(l.unitPrice),
        decimalCell(l.amount), csvCell(l.eachesPerUnit), decimalCell(l.eaches),
      ]);
      break;
    }
    case "skus": {
      header = ["sku", "category", "description", "cases", "eaches_per_case", "eaches", "sales", "avg_price", "pct_of_product_sales", "mixes_cases_and_packs"];
      rows = (await skuTable(f)).rows
        .sort((a, b) => b.sales - a.sales)
        .map((r) => [
          csvCell(r.sku), csvCell(r.category), csvCell(r.description), csvCell(r2(r.units)),
          csvCell(r.missingConversion ? "none" : r.mixedConversion ? "mixed" : r.eachesPerUnit), csvCell(r2(r.eaches)),
          csvCell(r2(r.sales)), csvCell(r.avgPrice === null ? null : r2(r.avgPrice)), csvCell(r1(r.pctOfSales)), csvCell(r.mixesPacks),
        ]);
      break;
    }
    case "customers": {
      header = ["customer", "cases", "eaches", "sales", "invoices", "skus_bought", "pct_of_sales"];
      rows = (await customerTable(f))
        .sort((a, b) => b.sales - a.sales)
        .map((r) => [csvCell(r.customer), csvCell(r2(r.units)), csvCell(r2(r.eaches)), csvCell(r2(r.sales)), csvCell(r.invoices), csvCell(r.skusBought), csvCell(r1(r.pctOfSales))]);
      break;
    }
    case "grid": {
      const g = await grid(f);
      header = ["customer", ...g.skus];
      rows = g.rows.map((r) => [csvCell(r.customer), ...g.skus.map((s) => csvCell(r2(r.cells[s] ?? 0)))]);
      break;
    }
    case "months": {
      header = ["month", "sales", "cases", "eaches"];
      rows = (await byMonth(f)).map((r) => [csvCell(r.month.slice(0, 7)), csvCell(r2(r.sales)), csvCell(r2(r.units)), csvCell(r2(r.eaches))]);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }

  const name = `remedium-${kind}-${f.from}-to-${f.to}.csv`;
  return new NextResponse(toCsv(header, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
