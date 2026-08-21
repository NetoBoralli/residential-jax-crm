import Link from "next/link";

import { OracleDown, Placeholder, Stat, num, when } from "@/components/ui";
import { all } from "@/lib/db";
import {
  OracleUnavailable,
  getDatasetInfo,
  listPipelineRuns,
} from "@/lib/oracle-client";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [counts] = await all<{
    searches: number;
    alerts: number;
    unread: number;
    opps: number;
    live: number;
  }>(`
    SELECT (SELECT count(*) FROM saved_searches)                              AS searches,
           (SELECT count(*) FROM notifications)                               AS alerts,
           (SELECT count(*) FROM notifications WHERE read_at IS NULL)          AS unread,
           (SELECT count(*) FROM opportunities)                                AS opps,
           (SELECT count(*) FROM opportunities WHERE stage NOT IN ('Closed','Dead')) AS live
  `);

  let dataset;
  let runs;
  let oracleError: string | undefined;
  try {
    [dataset, runs] = await Promise.all([
      getDatasetInfo(),
      listPipelineRuns(5),
    ]);
  } catch (error) {
    oracleError =
      error instanceof OracleUnavailable
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  }

  const latest = runs?.runs?.[0];

  return (
    <>
      <h1>Residential acquisition, Duval County</h1>
      <p className="lede">
        A map-based CRM for a Jacksonville acquisitions desk. It holds saved
        criteria, opportunities and outreach — and not one row of county
        property data. Every property fact on every page is read live from the{" "}
        <Link href="/integration">Duval Oracle pipeline</Link> over MCP, so the
        CRM and the pipeline can never disagree about what a parcel is.
      </p>

      <div className="grid" style={{ marginTop: 24 }}>
        <Stat
          testId="stat-properties"
          value={oracleError ? "—" : num(dataset?.totals?.["properties"])}
          label="Duval parcels searchable"
          hint="Read from the pipeline's published artifact, not stored here."
        />
        <Stat
          testId="stat-searches"
          value={num(counts?.searches)}
          label="Saved criteria sets"
          href="/searches"
        />
        <Stat
          testId="stat-alerts"
          value={num(counts?.alerts)}
          label="Alerts raised"
          hint={`${num(counts?.unread)} unread`}
          href="/notifications"
        />
        <Stat
          testId="stat-opportunities"
          value={num(counts?.opps)}
          label="Opportunities"
          hint={`${num(counts?.live)} still live`}
          href="/opportunities"
        />
      </div>

      {oracleError ? (
        <div style={{ marginTop: 28 }}>
          <OracleDown error={oracleError} />
        </div>
      ) : (
        <section style={{ marginTop: 32 }}>
          <h2>The pipeline behind this CRM</h2>
          <p className="muted">
            The Duval Oracle runs continuously and publishes each run as an
            immutable, content-addressed artifact. This CRM watches those runs:
            when one changes a property that matches saved criteria, it raises
            an alert naming the run and the record.
          </p>
          <table style={{ marginTop: 12 }} data-testid="recent-runs">
            <thead>
              <tr>
                <th>Run</th>
                <th>Started</th>
                <th>Mode</th>
                <th className="num">Inserted</th>
                <th className="num">Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs?.runs?.map((r) => (
                <tr key={r.run_id}>
                  <td className="mono">{r.run_id}</td>
                  <td className="subtle">{when(r.started_at)}</td>
                  <td>{r.mode}</td>
                  <td className="num">{num(r.inserts)}</td>
                  <td className="num">{num(r.updates)}</td>
                  <td>
                    <form action="/notifications" method="get">
                      <input type="hidden" name="run" value={r.run_id} />
                      <button className="btn btn-secondary" type="submit">
                        Alerts from this run
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {latest ? (
            <p className="subtle" style={{ marginTop: 10 }}>
              Latest run {latest.run_id} finished {when(latest.finished_at)}{" "}
              with {num(latest.inserts)} inserts and {num(latest.updates)}{" "}
              updates across {num(latest.records_in)} records read.
            </p>
          ) : null}
        </section>
      )}

      <section style={{ marginTop: 36 }}>
        <h2>Start here</h2>
        <div className="grid" style={{ marginTop: 12 }}>
          <Link className="card" href="/properties" data-testid="cta-find">
            <h3>Find properties →</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Set acquisition criteria — tenure, roof age, owner locality,
              water, transit, value band — and search 404,023 Duval parcels. Map
              and list, with a match score and its rationale on every row.
            </p>
          </Link>
          <Link className="card" href="/searches" data-testid="cta-searches">
            <h3>Saved criteria →</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Save a criteria set and have it checked against every new pipeline
              run. Alerts name the run and the specific changed record.
            </p>
          </Link>
          <Link className="card" href="/agent" data-testid="cta-agent">
            <h3>Ask in plain English →</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              &ldquo;Show me long-held homes in Arlington with roofs over 15
              years whose owners are out of state.&rdquo; The agent works
              through the same MCP tools this UI uses.
            </p>
          </Link>
          <Link className="card" href="/demo" data-testid="cta-demo">
            <h3>Guided demo →</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              The end-to-end flow in numbered steps: criteria → search → save →
              pipeline run → alert → opportunity → outreach → stage.
            </p>
          </Link>
        </div>
      </section>

      <section style={{ marginTop: 36 }}>
        <h2>Not built</h2>
        <p className="muted">
          Scope that was considered and deliberately left out, rather than
          quietly omitted. Each is a real extension point, not a stub waiting to
          be filled in.
        </p>
        <div className="grid" style={{ marginTop: 12 }}>
          <Placeholder title="Court-data distress signals" testId="ph-court">
            Foreclosure filings, liens, probate and code-enforcement actions
            would sharpen distress scoring considerably. Duval&rsquo;s court
            records are not part of the Florida DOR portal the pipeline ingests,
            and the roll carries no distress field, so nothing here would be
            derived — it would be invented.
          </Placeholder>
          <Placeholder
            title="Disposition and portfolio tracking"
            testId="ph-disposition"
          >
            The workflow here ends at Closed. Tracking what happens to an asset
            afterwards — rehab, hold, resale, portfolio performance — is a
            second product with its own data model.
          </Placeholder>
          <Placeholder
            title="Live messaging integrations"
            testId="ph-messaging"
          >
            Outreach is simulated end to end. Wiring a real ESP or SMS provider
            means consent capture, suppression lists, and per-state solicitation
            rules — none of which should be faked in a demo.
          </Placeholder>
        </div>
      </section>
    </>
  );
}
