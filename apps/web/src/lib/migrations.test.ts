import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Migrations must be safe on an old volume and on a fresh one.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so
 * a column added to schema.sql reaches a new database and never reaches the
 * deployed one. That shipped once and took /notifications down with a binder
 * error while every local run passed, because every local run started empty.
 *
 * This builds a store at the *old* shape, applies the migrations, and asserts
 * the new column is there — the case the deploy actually hits.
 */
describe("migrations", () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-migrate-"));
  });

  it("adds captured_matches to a notifications table created without it", async () => {
    const instance = await DuckDBInstance.create(path.join(dir, "old.duckdb"));
    const conn = await instance.connect();

    // The shape shipped before captured_matches existed.
    await conn.run(`
      CREATE TABLE notifications (
        notification_id TEXT PRIMARY KEY,
        search_id       TEXT NOT NULL,
        run_id          TEXT NOT NULL,
        matched_count   INTEGER NOT NULL,
        changed_in_run  INTEGER NOT NULL
      )
    `);
    await conn.run(
      `INSERT INTO notifications VALUES ('alert-1', 's-1', 'run-1', 7, 20)`,
    );

    const { MIGRATIONS } = await import("./db");
    for (const stmt of MIGRATIONS) await conn.run(stmt);

    // The column exists, the existing row survives, and it reads as unknown
    // rather than as zero — the alert predates the count being recorded.
    const rows = (
      await conn.runAndReadAll(
        `SELECT notification_id, captured_matches FROM notifications`,
      )
    ).getRowObjects();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["captured_matches"]).toBeNull();

    // Every migration is safe to run again on the same database.
    for (const stmt of MIGRATIONS) await conn.run(stmt);
    expect(
      (
        await conn.runAndReadAll(`SELECT count(*) AS n FROM notifications`)
      ).getRowObjects()[0]?.["n"],
    ).toBe(1n);
  });
});
