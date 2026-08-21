"use client";

/**
 * The last line of defence.
 *
 * Every page that reads the Oracle catches failure and renders a labelled
 * degraded state explaining that an empty screen is not an empty result. This
 * catches what those miss — a server action that rejects, a store error, a
 * fetch that throws where one was not expected — so the worst case is still a
 * page that says what went wrong rather than a framework stack trace.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="card"
      data-testid="app-error"
      style={{ marginTop: 32, borderColor: "var(--border-strong)" }}
    >
      <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
        Something went wrong
        <span className="badge badge-bad">error</span>
      </h2>
      <p className="muted" style={{ marginTop: 10 }}>
        This page did not finish loading. Nothing has been saved or changed. If
        it was a check against the pipeline, the Duval Oracle may be unreachable
        — the CRM holds no local copy of county data to fall back on, by design.
      </p>
      <pre
        className="mono subtle"
        style={{ marginTop: 12, whiteSpace: "pre-wrap" }}
      >
        {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>
      <div className="row-actions" style={{ marginTop: 14 }}>
        <button className="btn" type="button" onClick={reset}>
          Try again
        </button>
        <a className="btn btn-secondary" href="/">
          Back to the dashboard
        </a>
      </div>
    </div>
  );
}
