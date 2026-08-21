import Link from "next/link";

import { checkForMatchesAction } from "@/app/actions";
import { num, when } from "@/components/ui";
import { criteriaOf, listSearches } from "@/lib/searches";
import { describe, paramsFromCriteria } from "@/lib/criteria";
import { all } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function SearchesPage() {
  const searches = await listSearches();
  const counts = await all<{
    search_id: string;
    alerts: number;
    matches: number;
  }>(`
    SELECT search_id, count(*) AS alerts, COALESCE(sum(matched_count), 0) AS matches
      FROM notifications GROUP BY search_id
  `);
  const byId = new Map(counts.map((c) => [c.search_id, c]));

  return (
    <>
      <h1>Saved criteria</h1>
      <p className="lede">
        A saved criteria set is a standing question the pipeline answers for
        you. Each new run is checked against it, and a match raises an alert
        naming the run and the record that changed.
      </p>

      {searches.length === 0 ? (
        <div
          className="card"
          style={{ marginTop: 20 }}
          data-testid="no-searches"
        >
          <h3>Nothing saved yet</h3>
          <p className="muted" style={{ marginTop: 8 }}>
            Build a criteria set on{" "}
            <Link href="/properties">Find properties</Link> and press{" "}
            <strong>Save &amp; watch</strong>. The{" "}
            <Link href="/demo">guided demo</Link> walks the whole flow if you
            would rather follow along.
          </p>
        </div>
      ) : (
        <>
          <form
            action={checkForMatchesAction}
            style={{ marginTop: 20 }}
            data-testid="check-all-form"
          >
            <button className="btn" type="submit" data-testid="check-all">
              Check every watched set against recent runs
            </button>
            <span className="subtle" style={{ marginLeft: 10 }}>
              Idempotent — one alert per criteria set per run, however often you
              press it.
            </span>
          </form>

          <table style={{ marginTop: 18 }} data-testid="searches-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Criteria</th>
                <th>Watching</th>
                <th className="num">Alerts</th>
                <th className="num">Matches</th>
                <th>Last checked</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {searches.map((s) => {
                const c = criteriaOf(s);
                const stats = byId.get(s.search_id);
                return (
                  <tr key={s.search_id}>
                    <td>
                      <Link href={`/searches/${s.search_id}`}>{s.name}</Link>
                      <div className="subtle mono">{s.search_id}</div>
                    </td>
                    <td className="muted">{describe(c)}</td>
                    <td>
                      {s.notify ? (
                        <span className="badge badge-ok">watching</span>
                      ) : (
                        <span className="badge badge-muted">paused</span>
                      )}
                    </td>
                    <td className="num">{num(stats?.alerts ?? 0)}</td>
                    <td className="num">{num(stats?.matches ?? 0)}</td>
                    <td className="subtle">
                      {s.last_checked_run_id ? (
                        <>
                          {when(s.last_checked_at)}
                          <div className="mono subtle">
                            {s.last_checked_run_id}
                          </div>
                        </>
                      ) : (
                        "never"
                      )}
                    </td>
                    <td>
                      <Link
                        className="btn btn-secondary"
                        href={`/properties?${paramsFromCriteria(c).toString()}`}
                      >
                        Run now
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
