import "server-only";

import { all, lit, nextId, one, run } from "./db";
import {
  type Criteria,
  columnsFor,
  describe,
  score,
  whereFor,
} from "./criteria";
import {
  type OracleProperty,
  listPipelineRuns,
  matchChangedProperties,
  queryProperties,
} from "./oracle-client";

export interface SavedSearch {
  search_id: string;
  name: string;
  description: string | null;
  where_sql: string;
  criteria_json: string;
  owner_id: string;
  notify: boolean;
  created_at: string;
  last_checked_run_id: string | null;
  last_checked_at: string | null;
}

export function criteriaOf(s: SavedSearch): Criteria {
  try {
    return JSON.parse(s.criteria_json) as Criteria;
  } catch {
    return {};
  }
}

export async function listSearches(): Promise<SavedSearch[]> {
  return all<SavedSearch>(
    `SELECT * FROM saved_searches ORDER BY created_at DESC`,
  );
}

export async function getSearch(id: string): Promise<SavedSearch | undefined> {
  return one<SavedSearch>(
    `SELECT * FROM saved_searches WHERE search_id = ${lit(id)}`,
  );
}

export async function saveSearch(input: {
  name: string;
  description?: string;
  criteria: Criteria;
  ownerId: string;
  notify?: boolean;
}): Promise<string> {
  const id = await nextId("search");
  await run(`
    INSERT INTO saved_searches
      (search_id, name, description, where_sql, criteria_json, owner_id, notify)
    VALUES (${lit(id)}, ${lit(input.name)}, ${lit(input.description ?? describe(input.criteria))},
            ${lit(whereFor(input.criteria))}, ${lit(JSON.stringify(input.criteria))},
            ${lit(input.ownerId)}, ${input.notify === false ? "false" : "true"})
  `);
  return id;
}

/**
 * Deletes the criteria set and everything that only exists because of it.
 *
 * An alert's whole value is that it names the criteria it matched; orphaned, it
 * renders a raw id linking to a 404. There is no foreign key to cascade for us
 * — DuckDB does not enforce them — so the cascade is explicit, innermost first.
 */
export async function deleteSearch(id: string): Promise<void> {
  await run(`
    DELETE FROM notification_matches
     WHERE notification_id IN (
       SELECT notification_id FROM notifications WHERE search_id = ${lit(id)}
     )`);
  await run(`DELETE FROM notifications WHERE search_id = ${lit(id)}`);
  await run(`DELETE FROM saved_searches WHERE search_id = ${lit(id)}`);
}

export interface SearchResult {
  rows: Array<OracleProperty & { _score: number; _rationale: string[] }>;
  total: number;
  sql: string;
  durationMs: number;
  provenance: Record<string, unknown>;
}

/**
 * Run a criteria set against the live dataset.
 *
 * Two calls rather than one: a count over the whole match set, and a page of
 * rows. The count is what makes the answer honest — a list of 50 rows with no
 * total silently implies the answer is 50.
 */
export async function runSearch(
  criteria: Criteria,
  opts: { limit?: number } = {},
): Promise<SearchResult> {
  const where = whereFor(criteria);
  const cols = columnsFor(criteria).join(", ");
  const limit = Math.min(opts.limit ?? 100, 500);

  const [counted, page] = await Promise.all([
    queryProperties(
      `SELECT count(*) AS total FROM properties WHERE ${where}`,
      1,
    ),
    queryProperties(
      `SELECT ${cols} FROM properties WHERE ${where} ORDER BY market_value DESC NULLS LAST`,
      limit,
    ),
  ]);

  const total = Number(
    (counted.rows[0] as Record<string, unknown> | undefined)?.["total"] ?? 0,
  );

  const rows = page.rows
    .map((r) => {
      const s = score(criteria, r as Record<string, unknown>);
      return { ...r, _score: s.score, _rationale: s.rationale };
    })
    // Rank by how strongly each match satisfies the criteria, then by value.
    // Every row here already passes the filter; this orders within it.
    .sort(
      (a, b) =>
        b._score - a._score ||
        Number(b.market_value ?? 0) - Number(a.market_value ?? 0),
    );

  return {
    rows,
    total,
    sql: page.sql,
    durationMs: page.durationMs,
    provenance: page.provenance,
  };
}

export interface CheckResult {
  searchId: string;
  runId: string;
  changedInRun: number;
  matched: number;
  /** How many matched rows were captured as evidence — the Oracle caps this. */
  capturedMatches?: number;
  notificationId?: string;
  alreadySeen: boolean;
}

/** How far back a sweep looks. Named once; the UI copy quotes this number. */
export const MAX_RUNS_PER_SWEEP = 5;

/**
 * Check one saved search against one pipeline run and raise an alert if that
 * run changed anything matching it.
 *
 * The uniqueness constraint on (search_id, run_id) is what makes this safe to
 * call repeatedly — from the UI button, from a scheduled sweep, from a demo
 * script — without producing duplicate alerts for the same evidence.
 */
export async function checkSearchAgainstRun(
  search: SavedSearch,
  runId: string,
): Promise<CheckResult> {
  const existing = await one<{
    notification_id: string;
    matched_count: number;
  }>(
    `SELECT notification_id, matched_count FROM notifications
      WHERE search_id = ${lit(search.search_id)} AND run_id = ${lit(runId)}`,
  );
  if (existing) {
    return {
      searchId: search.search_id,
      runId,
      changedInRun: 0,
      matched: Number(existing.matched_count),
      notificationId: existing.notification_id,
      alreadySeen: true,
    };
  }

  const match = await matchChangedProperties({
    runId,
    where: search.where_sql,
    deltaTypes: ["insert", "update"],
    limit: 50,
  });

  await run(`
    UPDATE saved_searches
       SET last_checked_run_id = ${lit(runId)}, last_checked_at = now()
     WHERE search_id = ${lit(search.search_id)}
  `);

  if (match.matched === 0) {
    return {
      searchId: search.search_id,
      runId,
      changedInRun: match.changedInRun,
      matched: 0,
      alreadySeen: false,
    };
  }

  // The alert row and its evidence go in together. Written separately, a
  // restart between them (a redeploy during a sweep) leaves an alert claiming
  // 37 matches with 5 rows of evidence — and the idempotency guard above then
  // makes it permanent, because the repeat sweep sees the alert and stops. The
  // traceability claim is the whole feature, so it is written atomically.
  const notificationId = await nextId("alert");
  await run(`BEGIN TRANSACTION`);
  try {
    await run(`
      INSERT INTO notifications
        (notification_id, search_id, run_id, changes_cid, matched_count,
         captured_matches, changed_in_run, delta_types)
      VALUES (${lit(notificationId)}, ${lit(search.search_id)}, ${lit(runId)},
              ${lit(match.changesCid)}, ${lit(match.matched)}, ${lit(match.rows.length)},
              ${lit(match.changedInRun)}, ${lit("insert,update")})
    `);

    for (const row of match.rows) {
      await run(`
        INSERT INTO notification_matches
          (notification_id, folio, delta_type, address, owner_name, market_value)
        VALUES (${lit(notificationId)}, ${lit(row.request_identifier)},
                ${lit(String((row as Record<string, unknown>)["delta_type"] ?? "update"))},
                ${lit(row.address_street)}, ${lit(row.owner_name)}, ${lit(row.market_value)})
        ON CONFLICT DO NOTHING
      `);
    }
    await run(`COMMIT`);
  } catch (error) {
    await run(`ROLLBACK`).catch(() => undefined);
    throw error;
  }

  return {
    searchId: search.search_id,
    runId,
    changedInRun: match.changedInRun,
    matched: match.matched,
    capturedMatches: match.rows.length,
    notificationId,
    alreadySeen: false,
  };
}

export interface SweepResult {
  alerts: CheckResult[];
  watchedSearches: number;
  runsChecked: number;
  /** Set when the Oracle could not be reached at all. */
  unreachable?: string;
  /** Runs that could not be checked, with the reason. */
  skipped: Array<{ searchId: string; runId: string; reason: string }>;
  durationMs: number;
}

/**
 * Check watched criteria against recent runs.
 *
 * One implementation, called by both the UI button and the scheduler endpoint.
 * Two copies of this loop existed for about a day and had already drifted in
 * how they reported a skipped run — which is exactly the drift the endpoint's
 * own comment claimed could not happen.
 */
export async function sweepForMatches(
  opts: { searchId?: string; runId?: string; maxRuns?: number } = {},
): Promise<SweepResult> {
  const started = Date.now();
  const skipped: SweepResult["skipped"] = [];
  const alerts: CheckResult[] = [];

  let runs;
  let searches;
  try {
    [{ runs }, searches] = await Promise.all([
      listPipelineRuns(25),
      opts.searchId
        ? getSearch(opts.searchId).then((s) => (s ? [s] : []))
        : listSearches().then((all) => all.filter((s) => s.notify)),
    ]);
  } catch (error) {
    // The Oracle being unreachable is not "no matches". Reporting it as a
    // successful sweep would teach the user that an unchanged alert list means
    // nothing matched.
    return {
      alerts: [],
      watchedSearches: 0,
      runsChecked: 0,
      unreachable: error instanceof Error ? error.message : String(error),
      skipped: [],
      durationMs: Date.now() - started,
    };
  }

  // Newest first from the Oracle; checked oldest-to-newest so the alert list
  // reads in the order the runs actually happened.
  const candidates = (
    opts.runId ? runs.filter((r) => r.run_id === opts.runId) : runs
  )
    .filter((r) => r.status === "success")
    .slice(0, opts.maxRuns ?? MAX_RUNS_PER_SWEEP)
    .reverse();

  for (const search of searches) {
    for (const run of candidates) {
      try {
        alerts.push(await checkSearchAgainstRun(search, run.run_id));
      } catch (error) {
        // A run published before change tracking existed has no changes
        // artifact. That is a fact about that run, not a failure of the sweep,
        // so the remaining runs still get checked — and it is recorded rather
        // than swallowed.
        skipped.push({
          searchId: search.search_id,
          runId: run.run_id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    alerts,
    watchedSearches: searches.length,
    runsChecked: candidates.length,
    skipped,
    durationMs: Date.now() - started,
  };
}
