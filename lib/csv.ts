// CSV writing. Text cells that a spreadsheet would treat as a formula
// (starting with = + - @, tab or CR) get a leading apostrophe; numbers are
// written as numbers, so negative credit-memo amounts stay numeric.

export type Cell = string | number | boolean | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A numeric value that arrives as an exact decimal string (e.g. "-322.00"): written unquoted, never escaped. */
export function decimalCell(s: string | null | undefined): string {
  if (s === null || s === undefined || s === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Not a decimal: ${s}`);
  return s;
}

export function toCsv(header: string[], rows: string[][]): string {
  // A BOM so Excel opens UTF-8 correctly.
  return "﻿" + [header.map(csvCell).join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}
