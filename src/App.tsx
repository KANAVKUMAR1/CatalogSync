import { useMemo, useState } from "react";
import {
  analyze,
  applyFix,
  applySafeFixes,
  downloadCsv,
  downloadExcel,
  parseSpreadsheet,
  type CellValue,
  type Issue,
  type Severity,
} from "./core";
import { ConfirmDialog, DataTable, HealthScore, IssuesPanel, SeverityCard, UploadZone } from "./components";

const CHECK_LIST = [
  "Exact duplicate rows",
  "Duplicate SKUs",
  "Missing required values",
  "Invalid prices",
  "Inconsistent capitalization",
  "Inconsistent whitespace",
  "Duplicate product names",
];

export default function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CellValue[][]>([]);
  const [analysis, setAnalysis] = useState<ReturnType<typeof analyze> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<Issue | null>(null);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const data = await parseSpreadsheet(file);
      setHeaders(data.headers);
      setRows(data.rows);
      setAnalysis(analyze(data.headers, data.rows));
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setAnalysis(null);
    setError(null);
  };

  const commit = (nextRows: CellValue[][]) => {
    setRows(nextRows);
    setAnalysis(analyze(headers, nextRows));
  };

  const handleFix = (issue: Issue) => {
    if (issue.destructive) {
      setPendingRemove(issue);
      return;
    }
    commit(applyFix(rows, issue));
  };

  const confirmRemove = () => {
    if (pendingRemove) commit(applyFix(rows, pendingRemove));
    setPendingRemove(null);
  };

  const handleFixAll = () => {
    if (headers.length === 0 || rows.length === 0) return;
    commit(applySafeFixes(headers, rows));
  };

  const cellIssues = useMemo(() => {
    const map = new Map<string, Issue[]>();
    if (analysis) {
      for (const iss of analysis.issues) {
        if (iss.row < 0 || iss.col < 0) continue;
        const key = `${iss.row}:${iss.col}`;
        const arr = map.get(key) ?? [];
        arr.push(iss);
        map.set(key, arr);
      }
    }
    return map;
  }, [analysis]);

  const fixableCount = useMemo(
    () => (analysis ? analysis.issues.filter((i) => i.fix && !i.destructive).length : 0),
    [analysis],
  );

  const severityCounts: { tone: Severity; label: string }[] = [
    { tone: "critical", label: "Critical" },
    { tone: "warning", label: "Warning" },
    { tone: "suggestion", label: "Suggestion" },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CatalogSync
        </div>
        <p className="privacy-note">Your files are processed locally in your browser and are never uploaded.</p>
        {fileName && (
          <button type="button" className="btn btn-ghost" onClick={reset}>
            Load new file
          </button>
        )}
      </header>

      {!fileName ? (
        <main className="landing">
          <h1 className="landing-title">Find what&apos;s wrong with your product catalog</h1>
          <p className="landing-sub">
            Upload an Excel or CSV catalog and CatalogSync instantly flags duplicate rows, missing required values,
            bad prices, and messy text — then fixes them with one click.
          </p>
          <UploadZone onFile={handleFile} busy={loading} />
          {error && <p className="error-text">{error}</p>}
          <ul className="check-strip">
            {CHECK_LIST.map((c) => (
              <li key={c} className="check-chip">
                {c}
              </li>
            ))}
          </ul>
        </main>
      ) : (
        analysis && (
          <main className="dashboard">
            <div className="toolbar">
              <div className="toolbar-file">
                <span className="file-icon" aria-hidden="true">
                  📄
                </span>
                <div>
                  <div className="file-name">{fileName}</div>
                  <div className="file-meta">
                    {headers.length} columns · {rows.length} rows
                  </div>
                </div>
              </div>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleFixAll}
                  disabled={fixableCount === 0}
                  title={fixableCount === 0 ? "No safe fixes available" : `Apply ${fixableCount} safe fixes`}
                >
                  Fix All ({fixableCount})
                </button>
                <button type="button" className="btn" onClick={() => downloadExcel(headers, rows, fileName)}>
                  Download Clean Excel
                </button>
                <button type="button" className="btn" onClick={() => downloadCsv(headers, rows, fileName)}>
                  Download CSV
                </button>
              </div>
            </div>

            <section className="score-row">
              <div className="card score-card">
                <HealthScore score={analysis.score} />
              </div>
              {severityCounts.map(({ tone, label }) => (
                <SeverityCard
                  key={tone}
                  tone={tone}
                  label={label}
                  count={
                    tone === "critical" ? analysis.critical : tone === "warning" ? analysis.warning : analysis.suggestion
                  }
                />
              ))}
            </section>

            <div className="dashboard-grid">
              <IssuesPanel issues={analysis.issues} headers={headers} onFix={handleFix} />
              <DataTable
                headers={headers}
                rows={rows}
                cellIssues={cellIssues}
                rowsSeverity={analysis.rowsSeverity}
                onFix={handleFix}
              />
            </div>
          </main>
        )
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        title="Remove duplicate row"
        body={
          pendingRemove
            ? `Remove the duplicate row ${pendingRemove.row + 2}? This is a destructive edit and cannot be undone.`
            : ""
        }
        confirmLabel="Remove"
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </div>
  );
}