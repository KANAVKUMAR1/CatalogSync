# AGENTS.md

Vite + React + TypeScript catalog-quality tool: browser-only Excel/CSV analysis via SheetJS (xlsx). Zero backend — never add server code. All processing is client-side: files are read via `File.arrayBuffer()` + `XLSX.read` and must never be uploaded.

Privacy message ("Your files are processed locally in your browser and are never uploaded.") must stay visible in the UI — it lives in the App header on both the landing and dashboard views.

## Structure

- `src/core.ts` — pure logic, no DOM/React: `parseSpreadsheet` (SheetJS ingest, header-row detection, blank-row trimming), `analyze` (7 checks → `{issues, critical, warning, suggestion, score, cells, rowsSeverity}`), `applyFix` / `applySafeFixes` (fix mutation model), `parsePrice`, `downloadExcel` / `downloadCsv` (exports the corrected matrix, no branding).
- `src/components.tsx` — presentational UI: `UploadZone`, `HealthScore` (SVG gauge), `SeverityCard`, `IssuesPanel`, `DataTable`, `ConfirmDialog`.
- `src/App.tsx` — two views (landing ↔ dashboard); owns `headers`/`rows`/`analysis` state. After any fix, it re-runs `analyze` on the mutated rows (issue row indices are only valid for the current matrix — never cache them across mutations).

## Data model & conventions

- Cells are `string | number | boolean | null`; analysis runs on a padded matrix (every row has `headers.length` cells).
- Health score formula (deterministic on purpose): `100 − critical×8 − warning×3 − suggestion`, clamped 0–100. Keep this reflected in tests if you change it.
- Fix kinds: `trim`, `case`, `price` are SAFE (apply immediately or via "Fix All"); `remove-row` is destructive and must go through the `ConfirmDialog`. Missing required values / duplicate SKU / duplicate names have no safe fix → shown as "Review".
- Required columns resolved by fuzzy header match (`product name`, `sku`, `price`, `category`); unresolved columns emit a file-level critical issue.
- `parsePrice` auto-parses ₹/Rs/INR/USD/$ markers and thousands separators; currency markers cause a warning on an otherwise-parseable price.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `tsc --noEmit && vite build` (typecheck + production build; use this to verify changes)
- `npm run typecheck` — `tsc --noEmit`
- `npm run preview` — serve production build

Speed of verification: `core.ts` is Node-runnable (type-stripping works on Node 24) — you can import it in a `.mjs` scratch script to test `analyze`/`parsePrice`/`applySafeFixes` without a browser, then delete the script. UI/parse/export code needs a browser; a dev-server smoke test is `npm run dev -- --port 5199` then request `/`.

## Gotchas

- SheetJS is pinned as a URL dependency in `package.json` (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), NOT the stale npm `xlsx@0.18.5` (outdated, has CVEs). Keep it that way. `npm install` must reach `cdn.sheetjs.com`.
- The `xlsx` static import makes the bundle ~700 kB; Vite warns about chunk size. It's expected for this app — don't try to "fix" it unless asked.
- SheetJS cell values: read with `header: 1, defval: null, blankrows: false`; header row is the first row with ≥2 filled cells that isn't all-numeric (skips title/metadata rows).