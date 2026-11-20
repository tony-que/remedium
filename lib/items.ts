// Rules that turn a QuickBooks item's fully qualified name into the fields the
// dashboard groups by. Used by the seed script now and by the sync in step 5.
//
// QuickBooks joins sub-item levels with ":", for example
//   "Wound Care Dressings:Silicone Foam Dressings:REMSF99B"

export const CATEGORY_SEPARATOR = " › ";

/** Item names (the last segment, case-insensitive) that are never products. */
export const NON_PRODUCT_NAMES = [
  "Product Partnership and Profit Share Services",
  "Shipping",
  "Research and Development",
  "DISCOUNT",
] as const;

const NON_PRODUCT_SET = new Set(NON_PRODUCT_NAMES.map((n) => n.toLowerCase()));

// "-AMZ", " - AMZ", "- AMZ" at the end of a SKU.
const AMAZON_SUFFIX = /\s*-\s*AMZ$/i;
// A pack code such as "-3PK" or " - 4PK" at the end of a SKU.
const PACK_SUFFIX = /\s*-\s*\d+\s*PK$/i;

export interface ParsedItem {
  /** Last segment of the full name, trimmed. */
  sku: string;
  /** Every segment before the SKU joined with " › ", or null when there are none. */
  category: string | null;
  /** SKU with any Amazon suffix and pack code removed. */
  baseSku: string;
  /** True when the SKU carries an Amazon suffix. */
  isAmazonVariant: boolean;
  /** True when the SKU carries a pack code, so its units count packs, not cases. */
  isPackVariant: boolean;
  /** Default product flag; the admin can override it per item. */
  isProduct: boolean;
}

/** Splits a QuickBooks fully qualified name into trimmed, non-empty segments. */
function segments(fullName: string): string[] {
  return fullName
    .split(":")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Removes trailing Amazon suffixes and pack codes, in any order, so
 * "REMSF99B - AMZ" and "SCAF1003-3PK-AMZ" become "REMSF99B" and "SCAF1003".
 */
export function baseSkuOf(sku: string): { baseSku: string; isAmazonVariant: boolean; isPackVariant: boolean } {
  let base = sku.trim();
  let isAmazonVariant = false;
  let isPackVariant = false;
  for (;;) {
    if (AMAZON_SUFFIX.test(base)) {
      base = base.replace(AMAZON_SUFFIX, "");
      isAmazonVariant = true;
    } else if (PACK_SUFFIX.test(base)) {
      base = base.replace(PACK_SUFFIX, "");
      isPackVariant = true;
    } else {
      break;
    }
  }
  // Never strip a SKU down to nothing.
  if (base.length === 0) return { baseSku: sku.trim(), isAmazonVariant: false, isPackVariant: false };
  return { baseSku: base, isAmazonVariant, isPackVariant };
}

export function parseItemName(fullName: string): ParsedItem {
  const parts = segments(fullName);
  const sku = parts.length > 0 ? parts[parts.length - 1] : fullName.trim();
  const categoryParts = parts.slice(0, -1);
  const category = categoryParts.length > 0 ? categoryParts.join(CATEGORY_SEPARATOR) : null;
  const { baseSku, isAmazonVariant, isPackVariant } = baseSkuOf(sku);
  const isProduct = category !== null && !NON_PRODUCT_SET.has(sku.toLowerCase());
  return { sku, category, baseSku, isAmazonVariant, isPackVariant, isProduct };
}

/**
 * The product line a SKU belongs to, by its first letters (case-insensitive):
 * REM or RH is Wound Care, SC is Skincare, anything else is Support Surfaces.
 * The sales_lines view applies the same rule in SQL, and gives non-product
 * lines no line at all.
 */
export function productLineOf(sku: string): "wound" | "skin" | "support" {
  const s = sku.trim().toUpperCase();
  if (s.startsWith("REM") || s.startsWith("RH")) return "wound";
  if (s.startsWith("SC")) return "skin";
  return "support";
}
