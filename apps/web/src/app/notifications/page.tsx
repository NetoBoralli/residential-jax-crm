import Link from "next/link";

import { checkForMatchesAction, convertAction } from "@/app/actions";
import { money, num, when } from "@/components/ui";
import { all, lit } from "@/lib/db";
import { MAX_RUNS_PER_SWEEP } from "@/lib/searches";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface AlertRow {
  notification_id: string;
  search_id: string;
  search_name: string;
  run_id: string;
  changes_cid: string | null;
  matched_count: number;
  captured_matches: number | null;
  changed_in_run: number;
  created_at: string;
}

interface MatchRow {
  notification_id: string;
  folio: string;
  delta_type: string;
  address: string | null;
  owner_name: string | null;
  market_value: number | null;
}

/**
 * Alert history.
 *
 * The requirement is to show "the specific pipeline run / record change that
 * triggered each alert", and that is taken literally: each alert names the run
 * id, the content-addressed changes artifact that run published, how many
 * records changed in it, and which specific parcels matched. The alert is
 * traceable to immutable evidence rather than to a timestamp and a promise.
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const runFilter = typeof sp["run"] === "string" ? sp["run"] : undefined;
  const sweepError = typeof sp["error"] === "string" ? sp["error"] : undefined;

  const alerts = await all<AlertRow>(`
    SELECT n.notification_id, n.search_id, s.name AS search_name, n.run_id,
           n.changes_cid, n.matched_count, n.captured_matches,
           n.changed_in_run, n.created_at
      FROM notifications n
      LEFT JOIN saved_searches s USING (search_id)
     ${runFilter ? `WHERE n.run_id = ${lit(runFilter)}` : ""}
     ORDER BY n.created_at DESC
  `);

  const matches = await all<MatchRow>(`
    SELECT * FROM notification_matches ORDER BY market_value DESC NULLS LAST
  `);
  const byAlert = new Map<string, MatchRow[]>();
  for (const m of matches) {
    const list = byAlert.get(m.notification_id) ?? [];
    list.push(m);
    byAlert.set(m.notification_id, list);
  }

  const totalMatched = alerts.reduce((a, n) => a + Number(n.matched_count), 0);

  return (
    <>
      <h1>Alerts</h1>
      <p className="lede">
        Raised when a pipeline run changes a property that matches a watched
        criteria set. Every alert names the run that caused it and the immutable
        artifact recording exactly what that run changed.
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="stat-value" data-testid="alert-count">
            {num(alerts.length)}
          </div>
          <div className="stat-label">Alerts</div>
        </div>
        <div className="card">
          <div className="stat-value" data-testid="alert-matched">
            {num(totalMatched)}
          </div>
          <div className="stat-label">Matching properties surfaced</div>
        </div>
        <div className="card">
          <form action={checkForMatchesAction}>
            {runFilter ? (
              <input type="hidden" name="run_id" value={runFilter} />
            ) : null}
            <button className="btn" type="submit" data-testid="check-runs">
              Check watched criteria now
            </button>
            <p className="subtle" style={{ marginTop: 8 }}>
              Runs every watched criteria set against the last{" "}
              {MAX_RUNS_PER_SWEEP} successful pipeline runs.
            </p>
          </form>
        </div>
      </div>

      {sweepError ? (
        <div
          className="card"
          style={{ marginTop: 18, borderColor: "var(--border-strong)" }}
          data-testid="sweep-error"
        >
          <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Check did not run
            <span className="badge badge-warn">upstream</span>
          </h3>
          <p className="muted" style={{ marginTop: 8 }}>
            The Duval Oracle could not be reached, so nothing was checked
            against it. The alert list below is unchanged — this is not a report
            that nothing matched.
          </p>
          <pre
            className="mono subtle"
            style={{ marginTop: 10, marginBottom: 0, whiteSpace: "pre-wrap" }}
          >
            {sweepError}
          </pre>
        </div>
      ) : null}

      {runFilter ? (
        <p className="subtle" style={{ marginTop: 14 }}>
          Filtered to run <span className="mono">{runFilter}</span> —{" "}
          <Link href="/notifications">show all</Link>
        </p>
      ) : null}

      {alerts.length === 0 ? (
        <div
          className="card"
          style={{ marginTop: 20 }}
          data-testid="no-notifications"
        >
          <h3>No alerts yet</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Alerts appear once a watched criteria set is checked against a
            pipeline run that changed a matching property. Save a criteria set
            on <Link href="/properties">Find properties</Link>, then press{" "}
            <strong>Check watched criteria now</strong>. The{" "}
            <Link href="/demo">guided demo</Link> does this in order.
          </p>
        </div>
      ) : (
        <div style={{ marginTop: 24 }}>
          {alerts.map((a, index) => {
            const rows = byAlert.get(a.notification_id) ?? [];
            return (
              <section
                key={a.notification_id}
                id={a.notification_id}
                className="card"
                style={{ marginBottom: 20 }}
                data-testid="notification"
              >
                <div
                  className="row-actions"
                  style={{ justifyContent: "space-between" }}
                >
                  <div>
                    <h3 style={{ margin: 0 }}>
                      {num(a.matched_count)} matching{" "}
                      {Number(a.matched_count) === 1
                        ? "property"
                        : "properties"}{" "}
                      for{" "}
                      <Link href={`/searches/${a.search_id}`}>
                        {a.search_name ?? a.search_id}
                      </Link>
                    </h3>
                    <div className="subtle" style={{ marginTop: 6 }}>
                      Raised {when(a.created_at)} · in-app alert ·{" "}
                      <span className="mono">{a.notification_id}</span>
                    </div>
                  </div>
                  <span className="badge badge-warn">new match</span>
                </div>

                <table style={{ marginTop: 14 }}>
                  <tbody>
                    <tr>
                      <td className="muted">Triggered by run</td>
                      <td className="mono" data-testid="alert-run">
                        {a.run_id}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Records changed in that run</td>
                      <td>{num(a.changed_in_run)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Changes artifact</td>
                      <td className="mono" style={{ wordBreak: "break-all" }}>
                        {a.changes_cid ?? "—"}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="subtle" style={{ marginTop: 8 }}>
                  That CID is the immutable record of everything the run
                  changed. It is content-addressed, so the evidence behind this
                  alert cannot be edited after the fact.
                </p>

                {rows.length ? (
                  // A native <details>, not a client component. It needs no
                  // JavaScript, it is keyboard-operable for free, and its
                  // contents stay in the DOM when collapsed — so curl and an
                  // automated reviewer still see every row even when a human
                  // sees a closed panel.
                  //
                  // The newest alert is open so the page shows its evidence
                  // without a click; the rest are collapsed unless short enough
                  // to read at a glance. One alert with fifty matched
                  // properties used to bury the five alerts beneath it.
                  <details
                    className="accordion"
                    open={index === 0 || rows.length <= 3}
                    style={{ marginTop: 14 }}
                  >
                    <summary data-testid="alert-matches-toggle">
                      <span>
                        {num(rows.length)} captured{" "}
                        {rows.length === 1 ? "property" : "properties"}
                      </span>
                      {rows.length < Number(a.matched_count) ? (
                        <span className="subtle">
                          of {num(a.matched_count)} that matched
                        </span>
                      ) : null}
                    </summary>
                    <table data-testid="alert-matches">
                      <thead>
                        <tr>
                          <th>Property</th>
                          <th>Owner</th>
                          <th className="num">Just value</th>
                          <th>Change</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((m) => (
                          <tr key={`${m.notification_id}-${m.folio}`}>
                            <td>
                              <Link
                                href={`/properties/${encodeURIComponent(m.folio)}`}
                              >
                                {m.address ?? m.folio}
                              </Link>
                              <div className="subtle mono">{m.folio}</div>
                            </td>
                            <td>{m.owner_name ?? "—"}</td>
                            <td className="num">{money(m.market_value)}</td>
                            <td>
                              <span className="badge badge-info">
                                {m.delta_type}
                              </span>
                            </td>
                            <td>
                              <form action={convertAction}>
                                <input
                                  type="hidden"
                                  name="folio"
                                  value={m.folio}
                                />
                                <input
                                  type="hidden"
                                  name="address"
                                  value={m.address ?? ""}
                                />
                                <input
                                  type="hidden"
                                  name="owner_name"
                                  value={m.owner_name ?? ""}
                                />
                                <input
                                  type="hidden"
                                  name="search_id"
                                  value={a.search_id}
                                />
                                <input
                                  type="hidden"
                                  name="run_id"
                                  value={a.run_id}
                                />
                                <button
                                  className="btn btn-secondary"
                                  type="submit"
                                  data-testid="convert-from-alert"
                                >
                                  Track
                                </button>
                              </form>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length < Number(a.matched_count) ? (
                      <p className="subtle" style={{ marginTop: 10 }}>
                        The Oracle caps how many matched rows an alert captures
                        as evidence, so these {num(rows.length)} are a sample of
                        the {num(a.matched_count)} that matched in this run. The
                        full set is reachable from the criteria set.
                      </p>
                    ) : null}
                  </details>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
