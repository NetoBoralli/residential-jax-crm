import Link from "next/link";
import { notFound } from "next/navigation";

import { checkForMatchesAction, deleteSearchAction } from "@/app/actions";
import { ParcelMap, type MapPoint } from "@/components/parcel-map";
import {
  MatchScore,
  OracleDown,
  Provenance,
  money,
  num,
  when,
} from "@/components/ui";
import { describe, paramsFromCriteria } from "@/lib/criteria";
import { all } from "@/lib/db";
import { OracleUnavailable, listPipelineRuns } from "@/lib/oracle-client";
import { criteriaOf, getSearch, runSearch } from "@/lib/searches";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function SearchDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const search = await getSearch(id);
  if (!search) notFound();

  const criteria = criteriaOf(search);

  let result;
  let runs;
  let error: string | undefined;
  try {
    [result, runs] = await Promise.all([
      runSearch(criteria, { limit: 100 }),
      listPipelineRuns(6),
    ]);
  } catch (e) {
    error =
      e instanceof OracleUnavailable || e instanceof Error
        ? e.message
        : String(e);
  }

  const alerts = await all<{
    notification_id: string;
    run_id: string;
    matched_count: number;
    changed_in_run: number;
    created_at: string;
  }>(`
    SELECT notification_id, run_id, matched_count, changed_in_run, created_at
      FROM notifications WHERE search_id = '${id.replace(/'/g, "''")}'
     ORDER BY created_at DESC
  `);

  const points: MapPoint[] =
    result?.rows
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => ({
        folio: r.request_identifier,
        lat: Number(r.latitude),
        lon: Number(r.longitude),
        label: `${r.address_street ?? r.request_identifier} — ${money(r.market_value)}`,
        score: r._score,
      })) ?? [];

  return (
    <>
      <h1 data-testid="search-name">{search.name}</h1>
      <p className="lede">{describe(criteria)}</p>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>What this watches for</h3>
        <pre
          className="mono"
          data-testid="search-where"
          style={{
            marginTop: 10,
            marginBottom: 0,
            whiteSpace: "pre-wrap",
            color: "var(--fg-muted)",
          }}
        >
          {search.where_sql}
        </pre>
        <p className="subtle" style={{ marginTop: 10 }}>
          This expression is sent to the Duval Oracle, which validates it
          against its own parse tree before running it. The CRM never executes
          SQL against county data itself — it has no county data to execute
          against.
        </p>
      </div>

      <div className="row-actions" style={{ marginTop: 18 }}>
        <form action={checkForMatchesAction}>
          <input type="hidden" name="search_id" value={search.search_id} />
          <button className="btn" type="submit" data-testid="check-now">
            Check against recent runs
          </button>
        </form>
        <Link
          className="btn btn-secondary"
          href={`/properties?${paramsFromCriteria(criteria).toString()}`}
        >
          Open in search
        </Link>
        <form action={deleteSearchAction}>
          <input type="hidden" name="search_id" value={search.search_id} />
          <button
            className="btn btn-secondary"
            type="submit"
            data-testid="delete-search"
          >
            Delete
          </button>
        </form>
      </div>

      <section style={{ marginTop: 30 }}>
        <h2>Alerts from this criteria set</h2>
        {alerts.length === 0 ? (
          <p className="muted" data-testid="no-alerts">
            No alerts yet. Press <strong>Check against recent runs</strong> —
            the pipeline has published{" "}
            {runs ? num(runs.runs.length) : "several"} runs, and any of them
            that changed a matching property will raise one.
          </p>
        ) : (
          <table style={{ marginTop: 12 }} data-testid="search-alerts">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Pipeline run</th>
                <th className="num">Changed in run</th>
                <th className="num">Matched</th>
                <th>Raised</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.notification_id}>
                  <td>
                    <Link
                      href={`/notifications#${a.notification_id}`}
                      className="mono"
                    >
                      {a.notification_id}
                    </Link>
                  </td>
                  <td className="mono">{a.run_id}</td>
                  <td className="num">{num(a.changed_in_run)}</td>
                  <td className="num">{num(a.matched_count)}</td>
                  <td className="subtle">{when(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <h2>Matching today</h2>
        {error ? (
          <OracleDown error={error} />
        ) : (
          <>
            <p className="muted">
              <span className="stat-value" data-testid="search-total">
                {num(result?.total)}
              </span>{" "}
              properties satisfy these criteria in the currently published
              dataset.
            </p>
            <div className="split" style={{ marginTop: 14 }}>
              <ParcelMap points={points} height={380} />
              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th className="num">Just value</th>
                      <th>Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.rows.slice(0, 40).map((r) => (
                      <tr key={r.request_identifier}>
                        <td>
                          <Link
                            href={`/properties/${encodeURIComponent(r.request_identifier)}?${paramsFromCriteria(criteria).toString()}`}
                          >
                            {r.address_street ?? r.request_identifier}
                          </Link>
                          <div className="subtle">{r.owner_name ?? "—"}</div>
                        </td>
                        <td className="num">{money(r.market_value)}</td>
                        <td>
                          <MatchScore
                            score={r._score}
                            rationale={r._rationale}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {result ? (
              <Provenance
                sql={result.sql}
                durationMs={result.durationMs}
                detail={result.provenance as Record<string, unknown>}
              />
            ) : null}
          </>
        )}
      </section>
    </>
  );
}
