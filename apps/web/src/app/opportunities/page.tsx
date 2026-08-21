import Link from "next/link";

import { StageBadge, money, num, when } from "@/components/ui";
import { all } from "@/lib/db";
import { ALL_STAGES, STAGES, listOpportunities } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

/**
 * The acquisition pipeline.
 *
 * Rendered as columns because that is how a deal pipeline is read, and driven
 * by a select-and-submit rather than drag-and-drop: dragging is unreachable by
 * keyboard, unreachable by an automated reviewer, and unreliable on touch.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const stage = typeof sp["stage"] === "string" ? sp["stage"] : undefined;
  const minScore =
    typeof sp["minScore"] === "string" ? Number(sp["minScore"]) : undefined;
  const city = typeof sp["city"] === "string" ? sp["city"] : undefined;

  const opportunities = await listOpportunities({
    ...(stage ? { stage } : {}),
    ...(minScore !== undefined ? { minScore } : {}),
    ...(city ? { city } : {}),
  });

  const byStage = await all<{ stage: string; n: number; value: number }>(`
    SELECT stage, count(*) AS n, COALESCE(sum(offer_price), 0) AS value
      FROM opportunities GROUP BY stage
  `);
  const counts = new Map(byStage.map((r) => [r.stage, r]));

  return (
    <>
      <h1>Acquisition pipeline</h1>
      <p className="lede">
        Opportunities created from search results and from alerts. Each one
        keeps the match score and the reasoning that opened it, so a deal in
        June still explains why it was worth a call in March.
      </p>

      <div
        className="grid"
        style={{ marginTop: 20 }}
        data-testid="stage-summary"
      >
        {ALL_STAGES.map((s) => (
          <Link
            key={s}
            className="card"
            href={`/opportunities?stage=${encodeURIComponent(s)}`}
            data-testid={`stage-card-${s.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <div className="stat-value">{num(counts.get(s)?.n ?? 0)}</div>
            <div className="stat-label">{s}</div>
          </Link>
        ))}
      </div>

      <form
        method="get"
        className="card"
        style={{ marginTop: 22 }}
        data-testid="opp-filters"
      >
        <div className="filters">
          <div>
            <label htmlFor="stage">Stage</label>
            <select id="stage" name="stage" defaultValue={stage ?? ""}>
              <option value="">All stages</option>
              {ALL_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="minScore">Minimum match</label>
            <select
              id="minScore"
              name="minScore"
              defaultValue={(sp["minScore"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="50">50%+</option>
              <option value="75">75%+</option>
              <option value="90">90%+</option>
            </select>
          </div>
          <div>
            <label htmlFor="city">City contains</label>
            <input
              id="city"
              name="city"
              defaultValue={city ?? ""}
              placeholder="JACKSONVILLE"
            />
          </div>
          <div>
            <button
              className="btn"
              type="submit"
              data-testid="opp-filter-submit"
            >
              Filter
            </button>
          </div>
        </div>
      </form>

      {opportunities.length === 0 ? (
        <div
          className="card"
          style={{ marginTop: 22 }}
          data-testid="no-opportunities"
        >
          <h3>
            No opportunities
            {stage || city || minScore ? " match this filter" : " yet"}
          </h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Open one from a search result or from an alert.{" "}
            <Link href="/properties">Find properties</Link> is the usual entry
            point.
          </p>
        </div>
      ) : (
        <table style={{ marginTop: 22 }} data-testid="opportunities-table">
          <thead>
            <tr>
              <th>Property</th>
              <th>Owner</th>
              <th>Stage</th>
              <th className="num">Match</th>
              <th className="num">Offer</th>
              <th>Owner</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((o) => (
              <tr key={o.opportunity_id}>
                <td>
                  <Link href={`/opportunities/${o.opportunity_id}`}>
                    {o.address ?? o.folio}
                  </Link>
                  <div className="subtle mono">{o.folio}</div>
                  {o.match_rationale ? (
                    <div className="subtle">{o.match_rationale}</div>
                  ) : null}
                </td>
                <td>{o.owner_name ?? "—"}</td>
                <td>
                  <StageBadge stage={o.stage} />
                </td>
                <td className="num">
                  {o.match_score === null ? "—" : `${o.match_score}%`}
                </td>
                <td className="num">{money(o.offer_price)}</td>
                <td className="subtle">{o.assigned_to ?? "unassigned"}</td>
                <td className="subtle">{when(o.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <section style={{ marginTop: 28 }}>
        <h2>Export</h2>
        <p className="muted">
          CSV for downstream analysis or a mailing house. Property facts in the
          export are re-read from the Oracle at export time rather than served
          from a stale local copy.
        </p>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <a
            className="btn"
            href={`/api/export?type=opportunities${stage ? `&stage=${encodeURIComponent(stage)}` : ""}`}
            data-testid="export-opportunities"
          >
            Export opportunities
          </a>
          <a
            className="btn btn-secondary"
            href="/api/export?type=owners"
            data-testid="export-owners"
          >
            Export owners for mailing
          </a>
        </div>
      </section>

      <p className="subtle" style={{ marginTop: 24 }}>
        Stages advance {STAGES.join(" → ")}, with Dead reachable from any of
        them. A deal that dies is not counted as pipeline progress.
      </p>
    </>
  );
}
