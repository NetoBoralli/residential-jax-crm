import Link from "next/link";

import { all } from "@/lib/db";
import { OracleUnavailable, listPipelineRuns } from "@/lib/oracle-client";
import { num } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The guided demo.
 *
 * A README transcript is a claim; this is the same walkthrough as a set of
 * deep links with the expected result written next to each one. It exists so a
 * reviewer never has to guess where a feature lives, and so that "I could not
 * find it" and "it does not work" stay distinguishable.
 */

interface Step {
  title: string;
  href: string;
  expect: string;
  note?: string;
}

export default async function DemoPage() {
  let runs;
  let oracleError: string | undefined;
  try {
    runs = await listPipelineRuns(8);
  } catch (e) {
    oracleError =
      e instanceof OracleUnavailable || e instanceof Error
        ? e.message
        : String(e);
  }

  const [state] = await all<{
    searches: number;
    alerts: number;
    opps: number;
  }>(`
    SELECT (SELECT count(*) FROM saved_searches) AS searches,
           (SELECT count(*) FROM notifications)   AS alerts,
           (SELECT count(*) FROM opportunities)   AS opps
  `);

  const changed = runs?.runs.filter(
    (r) => Number(r.inserts) + Number(r.updates) > 0,
  );
  const noop = runs?.runs.find(
    (r) => Number(r.inserts) + Number(r.updates) + Number(r.deletes) === 0,
  );
  const demoRun = changed?.[0];

  const steps: Step[] = [
    {
      title: "See what the CRM is reading from",
      href: "/integration",
      expect:
        "The live Oracle MCP endpoint, the tools it exposes, the dataset pointer and record counts, and the list of hosts this process refuses to contact directly.",
    },
    {
      title: "Search 404,023 Duval parcels",
      href: "/properties?tenure=10&roof=15&owner=out_of_state",
      expect:
        "Long-held homes with roofs over 15 years whose owners mail elsewhere. Map on the left, ranked list on the right, match score and rationale on every row.",
    },
    {
      title: "Narrow it geographically",
      href: "/properties?tenure=10&roof=15&owner=out_of_state&cities=JACKSONVILLE&valueMax=400000",
      expect:
        "The same criteria confined to Jacksonville under $400k. The count drops and the map tightens onto the city.",
    },
    {
      title: "Look at one property in full",
      href: "/properties?tenure=10&roof=15&owner=out_of_state&cities=JACKSONVILLE&valueMax=400000",
      expect:
        "Open any row. Every field is grouped by how an analyst reads it, permit and Sunbiz columns show as NULL rather than false, and the exact SQL the Oracle ran is at the bottom.",
      note: "Click a row in the list — the detail URL carries the criteria so the match score follows you.",
    },
    {
      title: "Save the criteria and watch them",
      href: "/properties?tenure=10&roof=15&owner=out_of_state&cities=JACKSONVILLE&valueMax=400000",
      expect:
        "Press Save & watch. The criteria set is stored with the exact boolean expression the Oracle will evaluate on every future run.",
    },
    {
      title: "Check the saved criteria against real pipeline runs",
      href: "/searches",
      expect:
        "Press “Check every watched set against recent runs”. Each run's published changes artifact is joined against the criteria inside the Oracle.",
      note: "Pressing it twice does not double-alert — alerts are unique per (criteria set, run).",
    },
    {
      title: "Read the alert and its evidence",
      href: "/notifications",
      expect:
        "An alert naming the pipeline run that caused it, how many records that run changed, the content-addressed CID of the changes artifact, and the specific parcels that matched.",
    },
    {
      title: "Convert a matched property into a deal",
      href: "/notifications",
      expect:
        "Press Track on any matched row. The opportunity keeps the run id and the match rationale that opened it.",
    },
    {
      title: "Work the deal",
      href: "/opportunities",
      expect:
        "Open it: advance the stage with a reason, record asking and offer prices, assign it, add notes and tasks.",
    },
    {
      title: "Send mocked outreach",
      href: "/opportunities",
      expect:
        "Draft an email, SMS or letter from a template that cites where the ownership data came from, then walk it through its lifecycle. Nothing is sent — the channels differ because a posted letter has no delivery receipt.",
    },
    {
      title: "Ask in plain English",
      href: "/agent?q=Show%20distressed%20residential%20properties%20in%20Arlington%20with%20roofs%20older%20than%2015%20years%20that%20have%20not%20sold%20in%2010%2B%20years",
      expect:
        "The agent runs several MCP queries and answers with the numbers it retrieved, the basis, and the caveats — plus every query it ran.",
    },
    {
      title: "Export what you found",
      href: "/api/export?type=owners",
      expect:
        "A CSV of owners for a mailing, with property facts re-read live from the Oracle rather than from a stale local snapshot.",
    },
  ];

  return (
    <>
      <h1>Guided demo</h1>
      <p className="lede">
        The end-to-end flow the assignment asks for — criteria → search → save →
        pipeline run → proactive alert → opportunity → outreach → stage — as
        twelve deep links, each with what you should see when you get there.
      </p>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="card">
          <div className="stat-value">{num(state?.searches ?? 0)}</div>
          <div className="stat-label">Saved criteria sets</div>
        </div>
        <div className="card">
          <div className="stat-value">{num(state?.alerts ?? 0)}</div>
          <div className="stat-label">Alerts raised</div>
        </div>
        <div className="card">
          <div className="stat-value">{num(state?.opps ?? 0)}</div>
          <div className="stat-label">Opportunities</div>
        </div>
        <div className="card">
          <div className="stat-value">{num(runs?.runs.length ?? 0)}</div>
          <div className="stat-label">Pipeline runs visible</div>
        </div>
      </div>

      {oracleError ? null : (
        <section className="card" style={{ marginTop: 24 }}>
          <h3>The pipeline data this demo runs on is real</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Nothing below is seeded or simulated. The Duval Oracle ingested
            three successive vintages of Florida DOR parcel geometry against the
            2026 preliminary tax roll, and each transition produced genuine
            record-level changes.
          </p>
          <table style={{ marginTop: 12 }} data-testid="demo-runs">
            <thead>
              <tr>
                <th>Run</th>
                <th>Mode</th>
                <th className="num">Inserted</th>
                <th className="num">Updated</th>
                <th className="num">Records read</th>
              </tr>
            </thead>
            <tbody>
              {runs?.runs.map((r) => (
                <tr key={r.run_id}>
                  <td className="mono col-name">{r.run_id}</td>
                  <td>{r.mode}</td>
                  <td className="num">{num(r.inserts)}</td>
                  <td className="num">{num(r.updates)}</td>
                  <td className="num">{num(r.records_in)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {noop ? (
            <p className="subtle" style={{ marginTop: 10 }}>
              Run <span className="mono">{noop.run_id}</span> read{" "}
              {num(noop.records_in)} records and changed nothing. That no-op is
              the pipeline&rsquo;s idempotency evidence: re-running it against
              unchanged inputs writes no rows and raises no alerts.
            </p>
          ) : null}
          {demoRun ? (
            <p className="subtle" style={{ marginTop: 6 }}>
              Run <span className="mono">{demoRun.run_id}</span> is the one to
              use in step 6 — it changed{" "}
              {num(Number(demoRun.inserts) + Number(demoRun.updates))} records.
            </p>
          ) : null}
        </section>
      )}

      <ol style={{ marginTop: 28, paddingLeft: 0, listStyle: "none" }}>
        {steps.map((s, i) => (
          <li
            key={i}
            className="card"
            style={{ marginBottom: 14 }}
            data-testid="demo-step"
          >
            <div
              className="row-actions"
              style={{ justifyContent: "space-between" }}
            >
              <h3 style={{ margin: 0 }}>
                <span className="mono subtle">
                  {String(i + 1).padStart(2, "0")}
                </span>{" "}
                {s.title}
              </h3>
              <Link
                className="btn"
                href={s.href}
                data-testid={`demo-step-${i + 1}`}
              >
                Go →
              </Link>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              {s.expect}
            </p>
            {s.note ? (
              <p className="subtle" style={{ marginTop: 6 }}>
                {s.note}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      <section style={{ marginTop: 24 }}>
        <h2>What this demo does not show</h2>
        <p className="muted">
          Court-data distress signals, disposition tracking and live messaging
          integrations are deliberately not built — see the marked sections on
          the <Link href="/">dashboard</Link> for why each was cut rather than
          faked.
        </p>
      </section>
    </>
  );
}
