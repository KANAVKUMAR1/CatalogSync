import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import type { CellValue, Issue, Severity } from "./core";

export function UploadZone({
  onFile,
  busy,
}: {
  onFile: (file: File) => void;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const acceptFile = (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setInvalid("Unsupported file type. Please choose an .xlsx, .xls, or .csv file.");
      return;
    }
    setInvalid(null);
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  return (
    <div
      className={`upload-zone${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload a catalog file"
    >
      <div className="upload-icon" aria-hidden="true">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <p className="upload-text">{busy ? "Parsing file…" : "Drop your catalog here"}</p>
      <p className="upload-hint">or click to browse</p>
      <p className="upload-formats">Supports .xlsx · .xls · .csv</p>
      {invalid && <p className="upload-error">{invalid}</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden-input"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          if (file) acceptFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function HealthScore({ score }: { score: number }) {
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score));
  const tone = pct >= 80 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  return (
    <div className="score">
      <svg viewBox="0 0 104 104" width="120" height="120" role="img" aria-label={`Catalog health score ${pct} out of 100`}>
        <circle cx="52" cy="52" r={radius} fill="none" stroke="#e5eaf3" strokeWidth="10" />
        <circle
          cx="52"
          cy="52"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          transform="rotate(-90 52 52)"
        />
        <text x="52" y="52" textAnchor="middle" dy="0.35em" className="score-text">
          {pct}
        </text>
      </svg>
      <div className="score-label">Health score</div>
    </div>
  );
}

export function SeverityCard({ label, count, tone }: { label: string; count: number; tone: Severity }) {
  return (
    <div className={`card sev-card ${tone}`}>
      <div className="sev-count">{count}</div>
      <div className="sev-label">{label}</div>
    </div>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, body, confirmLabel = "Confirm", onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-body">{body}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function IssuesPanel({
  issues,
  headers,
  onFix,
}: {
  issues: Issue[];
  headers: string[];
  onFix: (issue: Issue) => void;
}) {
  const groups: { key: Severity; label: string; issues: Issue[] }[] = [
    { key: "critical", label: "Critical", issues: issues.filter((i) => i.severity === "critical") },
    { key: "warning", label: "Warning", issues: issues.filter((i) => i.severity === "warning") },
    { key: "suggestion", label: "Suggestion", issues: issues.filter((i) => i.severity === "suggestion") },
  ];

  return (
    <div className="issues-card card">
      <div className="issues-head">
        <h3>Issues found</h3>
        <span className="count-badge">{issues.length}</span>
      </div>
      {issues.length === 0 ? (
        <p className="clean-note">No issues detected — your catalog looks clean.</p>
      ) : (
        <div className="issue-groups">
          {groups.map(
            (g) =>
              g.issues.length > 0 && (
                <section key={g.key} className={`issue-group ${g.key}`}>
                  <h4>
                    <span className="dot" aria-hidden="true" />
                    {g.label} · {g.issues.length}
                  </h4>
                  <ul>
                    {g.issues.map((it) => {
                      const column = it.col >= 0 ? headers[it.col] : null;
                      const meta =
                        it.row >= 0 && it.col >= 0
                          ? `Row ${it.row + 2} · ${column ?? "cell"}`
                          : it.row >= 0
                            ? `Row ${it.row + 2}`
                            : "File";
                      return (
                        <li key={it.id} className="issue-item">
                          <div className="issue-main">
                            <span className="issue-msg">{it.message}</span>
                            <span className="issue-meta">{meta}</span>
                          </div>
                          {it.fix ? (
                            it.destructive ? (
                              <button type="button" className="btn btn-small btn-danger" onClick={() => onFix(it)}>
                                Remove
                              </button>
                            ) : (
                              <button type="button" className="btn btn-small" onClick={() => onFix(it)}>
                                Fix
                              </button>
                            )
                          ) : (
                            <span className="no-fix" title="No safe automatic fix is available for this issue.">
                              Review
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ),
          )}
        </div>
      )}
    </div>
  );
}

const SEV_RANK: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

function fmtCell(v: CellValue): string {
  if (v == null) return "";
  return String(v);
}

export function DataTable({
  headers,
  rows,
  cellIssues,
  rowsSeverity,
  onFix,
}: {
  headers: string[];
  rows: CellValue[][];
  cellIssues: Map<string, Issue[]>;
  rowsSeverity: Map<string, Severity>;
  onFix: (issue: Issue) => void;
}) {
  const PAGE = 200;
  const [visible, setVisible] = useState(PAGE);
  useEffect(() => {
    setVisible(PAGE);
  }, [rows]);

  const shown = rows.slice(0, visible);

  return (
    <div className="data-card card">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="col-num">#</th>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, r) => {
              const rowSev = rowsSeverity.get(String(r));
              return (
                <tr key={r} className={rowSev ? `row-${rowSev}` : ""}>
                  <td className="col-num">{r + 2}</td>
                  {headers.map((_, c) => {
                    const issues = cellIssues.get(`${r}:${c}`);
                    if (!issues) {
                      return <td key={c}>{fmtCell(row[c])}</td>;
                    }
                    const worst = issues.reduce((acc, cur) => (SEV_RANK[cur.severity] < SEV_RANK[acc.severity] ? cur : acc), issues[0]);
                    const fixable = issues.find((i) => i.fix && !i.destructive);
                    return (
                      <td key={c} className={`cell-${worst.severity}`} title={issues.map((i) => i.message).join("\n")}>
                        <span className="cell-value">{fmtCell(row[c])}</span>
                        {fixable && (
                          <button type="button" className="cell-fix" onClick={() => onFix(fixable)}>
                            fix
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty-note">No data rows to preview.</p>}
      {rows.length > shown.length && (
        <div className="load-more">
          <button type="button" className="btn" onClick={() => setVisible((v) => v + PAGE)}>
            Show more rows ({rows.length - shown.length} remaining)
          </button>
        </div>
      )}
    </div>
  );
}