import type { ReactNode } from "react";
import Link from "next/link";

export function Stat({
  value,
  label,
  hint,
  testId,
  href,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  testId?: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint ? (
        <div className="subtle" style={{ marginTop: 6 }}>
          {hint}
        </div>
      ) : null}
    </>
  );
  return href ? (
    <Link href={href} className="card" data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className="card" data-testid={testId}>
      {body}
    </div>
  );
}

export function num(value: unknown): string {
  // The null check comes first on purpose. `Number(null)` is 0, so a missing
  // count rendered a confident "0" — "the roll records no living area" and
  // "this parcel has zero square feet of living area" are different claims,
  // and the product's stated rule is that a gap is an em-dash.
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "—";
}

export function money(value: unknown): string {
  // A recorded price of $0 is data, not a gap. Florida quit-claims, trust
  // re-titling and intra-family transfers are routinely recorded at $0, and
  // that zero is itself the signal the tenure caveat is built on.
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) && n >= 0
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : "—";
}

/** Byte sizes, scaled. "0.00 MB" for a 41 KB artifact reads as "empty". */
export function bytes(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function cell(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (numeric) {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("en-US", { maximumFractionDigits: 1 })
      : String(value);
  }
  return String(value);
}

export function when(value: unknown): string {
  if (!value) return "—";
  const d = new Date(String(value));
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
}

/**
 * Signal strength, with the reasons behind it.
 *
 * Deliberately not labelled "% match". Everything in a result set matches every
 * criterion by construction, so a match percentage is 100 on every row and
 * tells an analyst nothing. This is how far past the thresholds a property
 * sits — a priority order within the matched set — and the clauses underneath
 * are the part that is actually actionable.
 */
export function MatchScore({
  score,
  rationale,
  testId,
}: {
  score: number;
  rationale: string[];
  testId?: string;
}) {
  // 50 is "meets every criterion". The bands are margin above that.
  const tone = score >= 80 ? "ok" : score >= 65 ? "warn" : "muted";
  return (
    <div data-testid={testId}>
      <span
        className={`badge badge-${tone}`}
        data-testid="match-score"
        title="Signal strength. 50 means it meets every criterion you set; above that is how far past your thresholds it sits."
      >
        signal {score}
      </span>
      {rationale.length ? (
        <div
          className="subtle"
          style={{ marginTop: 6 }}
          data-testid="match-rationale"
        >
          {rationale.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string }) {
  const tone =
    stage === "Closed"
      ? "ok"
      : stage === "Dead"
        ? "bad"
        : stage === "Under Contract"
          ? "info"
          : "warn";
  return (
    <span className={`badge badge-${tone}`} data-testid="stage">
      {stage}
    </span>
  );
}

/**
 * Where a fact came from.
 *
 * The assignment requires provenance on every displayed record, and this is
 * the component that discharges it: the pipeline run, the content-addressed
 * artifact, and the query that produced the row.
 */
export function Provenance({
  sql,
  durationMs,
  detail,
}: {
  sql?: string;
  durationMs?: number;
  detail?: Record<string, unknown>;
}) {
  return (
    <section style={{ marginTop: 28 }} data-testid="provenance">
      <h2>Provenance</h2>
      <div className="grid" style={{ marginTop: 12 }}>
        {sql ? (
          <div className="card">
            <h3>Query the Oracle ran</h3>
            <pre
              className="mono"
              data-testid="provenance-sql"
              style={{
                marginTop: 10,
                marginBottom: 0,
                overflowX: "auto",
                color: "var(--fg-muted)",
                whiteSpace: "pre",
              }}
            >
              {sql}
            </pre>
            {durationMs !== undefined ? (
              <div className="subtle" style={{ marginTop: 10 }}>
                Answered in {durationMs} ms by the Duval Oracle MCP. This CRM
                stores no property data of its own.
              </div>
            ) : null}
          </div>
        ) : null}
        {detail ? (
          <div className="card">
            <h3>Source</h3>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {Object.entries(detail).map(([k, v]) => (
                  <tr key={k}>
                    <td className="muted">{k.replace(/_/g, " ")}</td>
                    <td className="mono" style={{ wordBreak: "break-all" }}>
                      {String(v)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Shown when the Oracle cannot be reached.
 *
 * Deliberately not an empty list. A CRM that renders "0 properties" when its
 * data source is down teaches the user to believe an empty result, which is
 * the one lesson that costs them a deal.
 */
export function OracleDown({ error }: { error: string }) {
  return (
    <div
      className="card"
      data-testid="oracle-down"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        Duval Oracle unreachable
        <span className="badge badge-warn">upstream</span>
      </h2>
      <p className="muted" style={{ marginTop: 10 }}>
        Every property fact in this CRM is read live from the Duval Oracle
        pipeline&rsquo;s MCP endpoint. That call did not succeed, so there is
        nothing to show — this is not an empty result set, and it is not a claim
        that no properties match. The CRM holds no local copy of the county data
        to fall back on, by design.
      </p>
      <pre
        className="mono subtle"
        style={{ marginTop: 12, marginBottom: 0, whiteSpace: "pre-wrap" }}
      >
        {error}
      </pre>
    </div>
  );
}

/** A section that exists but is deliberately not built yet. */
export function Placeholder({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="card placeholder"
      data-testid={testId ?? "placeholder"}
      aria-disabled="true"
    >
      <h3>
        {title} <span className="badge badge-muted">Not built</span>
      </h3>
      <p className="muted" style={{ marginTop: 8 }}>
        {children}
      </p>
    </div>
  );
}
