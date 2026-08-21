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

export async function deleteSearch(id: string): Promise<void> {
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
  notificationId?: string;
  alreadySeen: boolean;
}

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

  const notificationId = await nextId("alert");
  await run(`
    INSERT INTO notifications
      (notification_id, search_id, run_id, changes_cid, matched_count, changed_in_run, delta_types)
    VALUES (${lit(notificationId)}, ${lit(search.search_id)}, ${lit(runId)},
            ${lit(match.changesCid)}, ${match.matched}, ${match.changedInRun}, ${lit("insert,update")})
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

  return {
    searchId: search.search_id,
    runId,
    changedInRun: match.changedInRun,
    matched: match.matched,
    notificationId,
    alreadySeen: false,
  };
}
