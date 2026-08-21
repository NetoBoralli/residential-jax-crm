import { DuckDBInstance } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";

import { all, run } from "./db";

/**
 * DuckDB returns class instances for temporal and decimal columns, and their
 * meaning is in `toString()`. Walking them as if they were plain row objects
 * rebuilt them field by field and discarded the value — every timestamp in the
 * product rendered as a dash and every one in a CSV export as "[object
 * Object]", which silently broke three acceptance criteria that ask for
 * history to be *shown*.
 *
 * These assert the values that reach a page, not the shape of the helper.
 */
describe("value normalisation", () => {
  beforeAll(async () => {
    await run(`CREATE TABLE IF NOT EXISTS normalise_probe (
      id TEXT, ts TIMESTAMPTZ, plain TIMESTAMP, d DATE, dec DECIMAL(8,2), big BIGINT
    )`);
    await run(`DELETE FROM normalise_probe`);
    await run(`INSERT INTO normalise_probe VALUES
      ('a', TIMESTAMPTZ '2026-08-21 04:05:06+00', TIMESTAMP '2026-08-21 04:05:06',
       DATE '2026-08-21', 1.5, 42)`);
  });

  it("renders temporal columns as strings a human and Date() can both read", async () => {
    const [row] = await all<Record<string, unknown>>(
      `SELECT * FROM normalise_probe`,
    );

    for (const key of ["ts", "plain", "d"]) {
      const value = row?.[key];
      expect(typeof value, `${key} should be a string`).toBe("string");
      expect(String(value)).toContain("2026-08-21");
      // The UI parses these with new Date(); an object would give Invalid Date.
      expect(Number.isNaN(new Date(String(value)).getTime())).toBe(false);
    }
  });

  it("keeps decimals and bigints usable as numbers", async () => {
    const [row] = await all<Record<string, unknown>>(
      `SELECT * FROM normalise_probe`,
    );
    expect(Number(row?.["dec"])).toBeCloseTo(1.5);
    expect(row?.["big"]).toBe(42);
  });

  it("does not stringify container columns, which are class instances too", async () => {
    const [row] = await all<Record<string, unknown>>(
      `SELECT {'a': 1, 'b': 2} AS nested, [1, 2, 3] AS items FROM normalise_probe`,
    );
    // The point is that these are NOT collapsed to a string by the temporal
    // fix — a struct and a list are containers, not scalar values.
    expect(typeof row?.["nested"]).toBe("object");
    expect(typeof row?.["items"]).toBe("object");
  });

  it("survives a JSON round trip, which is what an export does", async () => {
    const [row] = await all<Record<string, unknown>>(
      `SELECT * FROM normalise_probe`,
    );
    const json = JSON.stringify(row);
    expect(json).not.toContain("[object Object]");
    expect(json).toContain("2026-08-21");
  });
});

describe("DuckDB value shapes this depends on", () => {
  it("temporal values are class instances with their own toString", async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    const reader = await conn.runAndReadAll(
      `SELECT now() AS ts, DATE '2026-08-21' AS d, {'k': 1} AS obj`,
    );
    const row = reader.getRowObjects()[0]!;

    // If DuckDB ever renames these classes the normalise branch goes dead and
    // every date in the product silently blanks again. This test is what says
    // so.
    expect(row["ts"]?.constructor?.name).toMatch(/^DuckDBTimestamp/);
    expect(row["d"]?.constructor?.name).toBe("DuckDBDateValue");
    // A struct is a class instance too — which is why the fix matches on name
    // rather than on "has a custom prototype".
    expect(row["obj"]?.constructor?.name).toBe("DuckDBStructValue");
  });
});

describe("match scoring", () => {
  it("discriminates between rows that all pass the filter", async () => {
    const { score } = await import("./criteria");
    const criteria = { roofAgeMin: 15, tenureYearsMin: 10, portfolioMin: 2 };

    const weak = score(criteria, {
      roof_age_years: 16,
      years_since_last_sale: 11,
      owner_portfolio_size: 2,
    });
    const strong = score(criteria, {
      roof_age_years: 55,
      years_since_last_sale: 38,
      owner_portfolio_size: 30,
    });

    // Both satisfy every criterion; only their magnitude differs. A pass/fail
    // score gave both 100 and ranked nothing — and a raw strength share gave a
    // row sitting exactly on the thresholds a 0, which reads as "no match" for
    // something that matched.
    expect(weak.score).toBeGreaterThanOrEqual(50);
    expect(strong.score).toBeGreaterThan(weak.score + 40);
    // A property well past every threshold should reach the top of the scale,
    // not stall in the forties — otherwise the badge reads as a poor match for
    // something that is in fact the best candidate on the page.
    expect(strong.score).toBeGreaterThanOrEqual(90);
    expect(strong.score).toBeLessThanOrEqual(100);
    expect(weak.rationale.length).toBe(3);
  });

  it("still explains every satisfied facet regardless of strength", async () => {
    const { score } = await import("./criteria");
    const s = score(
      { roofAgeMin: 15, water: "waterfront" },
      {
        roof_age_years: 16,
        water_view_class: "waterfront",
        dist_to_water_m: 59,
      },
    );
    expect(s.rationale.some((r) => r.includes("roof"))).toBe(true);
    expect(s.rationale.some((r) => r.includes("m from"))).toBe(true);
  });

  it("never scores a matching property below the qualifying baseline", async () => {
    const { score, BASELINE } = await import("./criteria");
    // Exactly on every threshold: the weakest possible match, but a match.
    const atThreshold = score(
      { roofAgeMin: 15, tenureYearsMin: 10, portfolioMin: 2 },
      {
        roof_age_years: 15,
        years_since_last_sale: 10,
        owner_portfolio_size: 2,
      },
    );
    expect(atThreshold.score).toBe(BASELINE);
    expect(atThreshold.rationale.length).toBe(3);
  });

  it("scores nothing when no criteria were supplied", async () => {
    const { score } = await import("./criteria");
    expect(score({}, { roof_age_years: 90 })).toEqual({
      score: 0,
      rationale: [],
    });
  });
});
