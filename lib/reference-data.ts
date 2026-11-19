import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { parseItemName } from "@/lib/items";

// Admin edits to reference data: which items count as products, and eaches
// per unit. Callers must already have checked the actor is an admin.

export class ReferenceDataError extends Error {}

/** Sets an item's product flag by hand (`null` goes back to the automatic rule). The sync then leaves it alone. */
export async function setItemProduct(actor: string, qboId: string, value: boolean | null) {
  const item = await prisma.item.findUnique({ where: { qboId } });
  if (!item) throw new ReferenceDataError("That item doesn't exist.");
  const isProduct = value ?? parseItemName(item.fullName).isProduct;
  await prisma.item.update({ where: { qboId }, data: { isProduct, isProductSetByAdmin: value !== null } });
  await audit(actor, "item_product_set", { qboId, sku: item.sku, isProduct, byHand: value !== null });
  return { sku: item.sku, isProduct };
}

export function parseEaches(raw: unknown): number {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) throw new ReferenceDataError("Eaches per unit must be a whole number from 0 to 999999.");
  return Number(s);
}

/** Adds or changes one SKU's eaches per unit. Clears a "please fill in" note, since a person has now set it. */
export async function setConversion(actor: string, rawSku: string, rawEaches: unknown) {
  const sku = rawSku.trim();
  if (!sku || sku.length > 120) throw new ReferenceDataError("Enter the SKU exactly as it appears in QuickBooks.");
  const eachesPerUnit = parseEaches(rawEaches);
  const before = await prisma.skuConversion.findUnique({ where: { sku } });
  await prisma.skuConversion.upsert({
    where: { sku },
    create: { sku, eachesPerUnit, updatedBy: actor },
    update: { eachesPerUnit, updatedBy: actor, note: before?.note && /please fill in/i.test(before.note) ? null : before?.note },
  });
  await audit(actor, "conversion_set", { sku, eachesPerUnit, previous: before?.eachesPerUnit ?? null });
  return { sku, eachesPerUnit, previous: before?.eachesPerUnit ?? null };
}

export async function deleteConversion(actor: string, sku: string) {
  const { count } = await prisma.skuConversion.deleteMany({ where: { sku } });
  if (count === 0) throw new ReferenceDataError(`${sku} has no conversion.`);
  await audit(actor, "conversion_deleted", { sku });
}

/** Product SKUs in the item list with no conversion row. */
export async function productSkusWithoutConversion(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ sku: string }[]>`
    SELECT DISTINCT i.sku FROM items i
    LEFT JOIN sku_conversions c ON c.sku = i.sku
    WHERE i.is_product AND c.sku IS NULL ORDER BY i.sku`;
  return rows.map((r) => r.sku);
}
