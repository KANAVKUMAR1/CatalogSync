import * as XLSX from "xlsx";

export type CellValue = string | number | boolean | null;

export interface SheetData {
  headers: string[];
  rows: CellValue[][];
}

export type Severity = "critical" | "warning" | "suggestion";

export type IssueType =
  | "duplicate-row"
  | "duplicate-sku"
  | "missing-required"
  | "invalid-price"
  | "inconsistent-case"
  | "whitespace"
  | "duplicate-name";

export type Fix =
  | { kind: "trim" }
  | { kind: "case" }
  | { kind: "price"; value: number }
  | { kind: "remove-row" };

export interface Issue {
  id: string;
  type: IssueType;
  severity: Severity;
  row: number;
  col: number;
  message: string;
  fix: Fix | null;
  destructive: boolean;
}

export interface Analysis {
  issues: Issue[];
  critical: number;
  warning: number;
  suggestion: number;
  score: number;
  cells: Map<string, Severity>;
  rowsSeverity: Map<string, Severity>;
}

const REQUIRED_FIELDS = [
  {
    label: "Product Name",
    aliases: ["product name", "productname", "item name", "name"],
  },
  {
    label: "SKU",
    aliases: ["sku", "skuid", "sku id", "sku no", "item sku", "product sku", "part number"],
  },
  {
    label: "Price",
    aliases: ["price", "unit price", "sale price", "mrp", "rate", "price (inr)", "price inr"],
  },
  {
    label: "Category",
    aliases: ["category", "product category", "catalog category", "group"],
  },
] as const;

function isBlank(v: unknown): boolean {
  return v == null || String(v).trim() === "";
}

function toCellValue(v: unknown): CellValue {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return String(v);
  return v as CellValue;
}

function nonEmptyRow(row: CellValue[]): boolean {
  return row.some((c) => !isBlank(c));
}

function findHeaderIndex(rows: CellValue[][]): number {
  const idx = rows.findIndex((row) => {
    const filled = row.filter((c) => !isBlank(c));
    if (filled.length < 2) return false;
    const numeric = filled.filter(
      (c) =>
        typeof c === "number" ||
        (typeof c === "string" && Number.isFinite(Number(c.trim()))),
    ).length;
    return numeric < filled.length;
  });
  if (idx >= 0) return idx;
  return rows.findIndex((row) => row.some((c) => !isBlank(c)));
}

export async function parseSpreadsheet(file: File): Promise<SheetData> {
  let workbook: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array" });
  } catch {
    throw new Error("Could not read the file. Use an .xlsx, .xls, or .csv file exported from a spreadsheet app.");
  }
  if (!workbook.SheetNames.length) throw new Error("The file does not contain any sheets.");

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  }) as unknown[][];

  const rows: CellValue[][] = aoa.map((r) => r.map(toCellValue));
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex < 0) throw new Error("Could not find a header row in the file.");
  const headerRow = rows[headerIndex];
  if (!headerRow || headerRow.length === 0) throw new Error("Could not find a header row in the file.");

  const dataRows = rows.slice(headerIndex + 1).filter(nonEmptyRow);
  const colCount = Math.max(headerRow.length, ...dataRows.map((r) => r.length));
  if (!Number.isFinite(colCount) || colCount < 1) throw new Error("The file has no usable columns.");

  const headers: string[] = [];
  for (let c = 0; c < colCount; c++) {
    headers.push(String(headerRow[c] ?? "").trim() || `Column ${c + 1}`);
  }

  const padded = dataRows.map((r) => {
    const copy = r.slice();
    while (copy.length < colCount) copy.push(null);
    return copy;
  });

  return { headers, rows: padded };
}

function normHeader(h: string): string {
  return h.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveColumn(headers: string[], aliases: readonly string[]): number {
  const norms = headers.map(normHeader);
  for (const candidate of aliases) {
    const n = normHeader(candidate);
    const exact = norms.indexOf(n);
    if (exact >= 0) return exact;
    const loose = norms.findIndex((h) => h.endsWith(` ${n}`) || h.startsWith(`${n} `));
    if (loose >= 0) return loose;
  }
  return -1;
}

function parseNumericText(t: string): number | null {
  const plain = /^-?\d+(?:\.\d+)?$/;
  const grouped = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
  if (!plain.test(t) && !grouped.test(t)) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

const CURRENCY_PATTERN = /^(?:₹|\$|usd|us\$?|inr|rs\.?)\s*|\s*(?:₹|\$|usd|us\$?|inr|rs\.?)$/gi;

export function parsePrice(v: CellValue): number | null {
  const s = (v == null ? "" : String(v)).trim();
  if (s === "") return null;
  const direct = parseNumericText(s);
  if (direct !== null) return direct;
  const bare = s.replace(CURRENCY_PATTERN, "").trim();
  if (bare === s) return null;
  return parseNumericText(bare);
}

const HAS_CURRENCY = /[₹$]|rs\.?|inr|usd/i;
const WS_ISSUE = /^[ \t\u00a0]+|[ \t\u00a0]+$|[ \t\u00a0]{2,}/;
const RANK: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

function cellKey(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function analyze(headers: string[], rows: CellValue[][]): Analysis {
  const issues: Issue[] = [];
  let seq = 0;
  const push = (
    type: IssueType,
    severity: Severity,
    row: number,
    col: number,
    message: string,
    fix: Fix | null = null,
    destructive = false,
  ) => {
    issues.push({ id: `${type}:${row}:${col}:${seq}`, type, severity, row, col, message, fix, destructive });
    seq++;
  };

  const resolved = REQUIRED_FIELDS.map((f) => resolveColumn(headers, f.aliases));
  const [productNameCol, skuCol, priceCol, categoryCol] = resolved;

  for (let i = 0; i < REQUIRED_FIELDS.length; i++) {
    if (resolved[i] < 0) {
      push("missing-required", "critical", -1, -1, `Missing required column "${REQUIRED_FIELDS[i].label}".`);
    }
  }

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const v = rows[r][c];
      if (typeof v === "string" && WS_ISSUE.test(v)) {
        push("whitespace", "warning", r, c, "Inconsistent whitespace", { kind: "trim" });
      }
    }
  }

  const required = REQUIRED_FIELDS.map((f, i) => ({ label: f.label, col: resolved[i] })).filter((f) => f.col >= 0);
  for (const { label, col } of required) {
    for (let r = 0; r < rows.length; r++) {
      if (isBlank(rows[r][col])) push("missing-required", "critical", r, col, `Missing required value "${label}".`);
    }
  }

  if (priceCol >= 0) {
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][priceCol];
      if (isBlank(v)) continue;
      const s = String(v).trim();
      const num = parsePrice(v);
      if (num === null) {
        push("invalid-price", "critical", r, priceCol, `Invalid price "${s}".`);
      } else if (num < 0) {
        push("invalid-price", "critical", r, priceCol, `Negative price "${s}".`);
      } else if (HAS_CURRENCY.test(s)) {
        push("invalid-price", "warning", r, priceCol, `Price "${s}" parsed to ${num}.`, { kind: "price", value: num });
      }
    }
  }

  const caseCols = [productNameCol, categoryCol].filter((c) => c >= 0);
  for (const c of caseCols) {
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][c];
      if (typeof v !== "string" || isBlank(v)) continue;
      const s = v.trim();
      const m = s.match(/^[a-z]+/);
      if (m && m[0].length > 1 && s.length > 3) {
        push("inconsistent-case", "suggestion", r, c, `Inconsistent capitalization "${s}".`, { kind: "case" });
      }
    }
  }

  const seen = new Map<string, number>();
  for (let r = 0; r < rows.length; r++) {
    const key = rows[r].map(cellKey).join("\u0000");
    const prev = seen.get(key);
    if (prev !== undefined) {
      push("duplicate-row", "critical", r, -1, `Exact duplicate of row ${prev + 2}.`, { kind: "remove-row" }, true);
    } else {
      seen.set(key, r);
    }
  }

  if (skuCol >= 0) {
    const seenSku = new Map<string, number>();
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][skuCol];
      if (isBlank(v)) continue;
      const key = String(v).trim().toUpperCase();
      const prev = seenSku.get(key);
      if (prev !== undefined) {
        push("duplicate-sku", "warning", r, skuCol, `Duplicate SKU "${String(v).trim()}" (also row ${prev + 2}).`);
      } else {
        seenSku.set(key, r);
      }
    }
  }

  if (productNameCol >= 0) {
    const seenName = new Map<string, number>();
    for (let r = 0; r < rows.length; r++) {
      const v = rows[r][productNameCol];
      if (isBlank(v)) continue;
      const key = String(v).trim();
      const prev = seenName.get(key);
      if (prev !== undefined) {
        push("duplicate-name", "warning", r, productNameCol, `Possible duplicate of "${key}" (row ${prev + 2}).`);
      } else {
        seenName.set(key, r);
      }
    }
  }

  if (rows.length === 0) {
    push("missing-required", "critical", -1, -1, "The spreadsheet has no data rows.");
  }

  const cells = new Map<string, Severity>();
  const rowsSeverity = new Map<string, Severity>();
  let critical = 0;
  let warning = 0;
  let suggestion = 0;

  for (const iss of issues) {
    if (iss.severity === "critical") critical++;
    else if (iss.severity === "warning") warning++;
    else suggestion++;

    if (iss.row >= 0 && iss.col >= 0) {
      const key = `${iss.row}:${iss.col}`;
      const existing = cells.get(key);
      if (existing === undefined || RANK[iss.severity] < RANK[existing]) cells.set(key, iss.severity);
    }
    if (iss.row >= 0) {
      const key = String(iss.row);
      const existing = rowsSeverity.get(key);
      if (existing === undefined || RANK[iss.severity] < RANK[existing]) rowsSeverity.set(key, iss.severity);
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(100 - critical * 8 - warning * 3 - suggestion)));

  return { issues, critical, warning, suggestion, score, cells, rowsSeverity };
}

export function applyFix(rows: CellValue[][], issue: Issue): CellValue[][] {
  if (!issue.fix) return rows;
  if (issue.fix.kind === "remove-row") {
    return rows.filter((_, i) => i !== issue.row);
  }
  const next = rows.map((r) => r.slice());
  const row = next[issue.row];
  if (!row) return rows;
  const c = issue.col;
  switch (issue.fix.kind) {
    case "trim": {
      const v = row[c];
      if (typeof v === "string") row[c] = v.replace(/[\t\u00a0]/g, " ").replace(/ {2,}/g, " ").trim();
      break;
    }
    case "case": {
      const s = typeof row[c] === "string" ? (row[c] as string) : String(row[c] ?? "");
      const i = s.search(/[a-zA-Z]/);
      if (i >= 0) row[c] = s.slice(0, i) + s[i].toUpperCase() + s.slice(i + 1);
      break;
    }
    case "price":
      row[c] = issue.fix.value;
      break;
  }
  return next;
}

function fixOrder(kind: Fix["kind"]): number {
  switch (kind) {
    case "trim":
      return 0;
    case "case":
      return 1;
    case "price":
      return 2;
    case "remove-row":
      return 3;
  }
}

export function applySafeFixes(headers: string[], rows: CellValue[][]): CellValue[][] {
  let current = rows;
  for (let i = 0; i < 10; i++) {
    const analysis = analyze(headers, current);
    const fixes = analysis.issues.filter((iss) => iss.fix && !iss.destructive);
    if (fixes.length === 0) break;
    fixes.sort((a, b) => fixOrder(a.fix!.kind) - fixOrder(b.fix!.kind));
    for (const f of fixes) current = applyFix(current, f);
  }
  return current;
}

function baseFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base || "catalog";
}

function toExportValue(v: CellValue): string | number {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}

function buildWorksheet(headers: string[], rows: CellValue[][]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [headers, ...rows.map((r) => r.map(toExportValue))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = headers.map((_, c) => {
    let width = headers[c].length;
    for (const r of rows) {
      const v = toExportValue(r[c] ?? null);
      width = Math.max(width, typeof v === "number" ? String(v).length : v.length);
    }
    return { wch: Math.min(Math.max(width + 2, 8), 60) };
  });
  return ws;
}

export function downloadExcel(headers: string[], rows: CellValue[][], fileName: string): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildWorksheet(headers, rows), "Catalog");
  XLSX.writeFile(wb, `${baseFileName(fileName)}-cleaned.xlsx`);
}

export function downloadCsv(headers: string[], rows: CellValue[][], fileName: string): void {
  const ws = buildWorksheet(headers, rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseFileName(fileName)}-cleaned.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}