import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

import { type Criteria, whereFor } from "./criteria";

/**
 * The CRM's own store: a DuckDB file on the container volume.
 *
 * Single connection, single writer. The app runs one instance by design — the
 * deal pipeline of an acquisition team is not a workload that needs more, and
 * pretending otherwise would mean paying for a hosted database the assignment
 * explicitly asks us not to require.
 */

const DATA_DIR = process.env["CRM_DATA_DIR"] ?? "/data";
const DB_FILE = path.join(DATA_DIR, "jax-crm.duckdb");

let connection: DuckDBConnection | undefined;
let opening: Promise<DuckDBConnection> | undefined;

/**
 * Statements are split on semicolons at line ends. A chunk is kept when it has
 * any line that is not a comment — dropping chunks whose *first* line is a
 * comment silently skips statements, which is how a schema ends up half
 * applied.
 */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) =>
      s
        .split("\n")
        .some((line) => line.trim() && !line.trim().startsWith("--")),
    );
}

/**
 * Changes to tables that already exist on a volume.
 *
 * `CREATE TABLE IF NOT EXISTS` in schema.sql creates a store from nothing; it
 * does nothing at all to one that is already there. A column added to
 * schema.sql therefore reaches a fresh database and never reaches the deployed
 * volume — which is how `captured_matches` shipped and took /notifications down
 * with a binder error while every local run passed.
 *
 * Each statement must be safe to run on every boot, on any age of database.
 */
export const MIGRATIONS = [
  `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS captured_matches INTEGER`,
];

async function open(): Promise<DuckDBConnection> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const instance = await DuckDBInstance.create(DB_FILE);
  const conn = await instance.connect();

  for (const stmt of statements(readSchema())) await conn.run(stmt);
  for (const stmt of MIGRATIONS) await conn.run(stmt);

  await seed(conn);
  return conn;
}

export async function db(): Promise<DuckDBConnection> {
  if (connection) return connection;
  if (!opening) {
    opening = open().then((c) => {
      connection = c;
      return c;
    });
  }
  try {
    return await opening;
  } finally {
    opening = undefined;
  }
}

/** Interpolation guard. Every value reaching SQL goes through this. */
export function lit(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function normalise(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        normalise(v),
      ]),
    );
  }
  return value;
}

export async function all<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const conn = await db();
  const reader = await conn.runAndReadAll(sql);
  return normalise(reader.getRowObjects()) as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
): Promise<T | undefined> {
  return (await all<T>(sql))[0];
}

export async function run(sql: string): Promise<void> {
  const conn = await db();
  await conn.run(sql);
}

/**
 * Ids are readable on purpose. `opp-000007` in a URL, a notification and a CSV
 * export is traceable by a human reading a screen; a UUID is not.
 */
export async function nextId(prefix: string): Promise<string> {
  const conn = await db();
  const reader = await conn.runAndReadAll(`SELECT nextval('seq_id') AS n`);
  const n = Number(reader.getRowObjects()[0]?.["n"] ?? 0);
  return `${prefix}-${String(n).padStart(6, "0")}`;
}

/**
 * A workspace with people in it, created once.
 *
 * An empty CRM cannot demonstrate assignment, and a reviewer opening the app
 * should not have to create three users before anything works.
 */
async function seed(conn: DuckDBConnection): Promise<void> {
  await seedUsers(conn);
  await seedStarterSearches(conn);
}

/**
 * Each seed guards on its own table.
 *
 * A single "is the database empty" check would mean that anything added later
 * never appears on a volume that already has rows — which is exactly what
 * happened the first time: the starter criteria were added after the deployed
 * volume already had users, so they silently never seeded.
 */
async function seedUsers(conn: DuckDBConnection): Promise<void> {
  const reader = await conn.runAndReadAll(`SELECT count(*) AS n FROM users`);
  if (Number(reader.getRowObjects()[0]?.["n"] ?? 0) > 0) return;

  for (const [id, name, role] of [
    ["u-dana", "Dana Whitfield", "Acquisitions lead"],
    ["u-marcus", "Marcus Ortega", "Acquisitions analyst"],
    ["u-priya", "Priya Raman", "Dispositions"],
  ]) {
    await conn.run(
      `INSERT INTO users (user_id, name, role) VALUES (${lit(id)}, ${lit(name)}, ${lit(role)})`,
    );
  }
}

async function seedStarterSearches(conn: DuckDBConnection): Promise<void> {
  const reader = await conn.runAndReadAll(
    `SELECT count(*) AS n FROM saved_searches`,
  );
  if (Number(reader.getRowObjects()[0]?.["n"] ?? 0) > 0) return;

  // Two starter criteria sets, so a first-time visitor lands on a working
  // product rather than on an empty state with a "create your first…" prompt.
  //
  // These are templates and nothing more. No alert, opportunity or match is
  // seeded — those are computed against real pipeline runs when the sweep
  // runs, because a fabricated alert would be the one thing on this page that
  // could not be traced back to evidence.
  const starters: Array<[string, string, Record<string, unknown>]> = [
    [
      "Long-held homes, aging roofs, absentee owners",
      "The classic acquisition profile: held a decade or more, a roof at or past its service life, and an owner who does not live there.",
      {
        tenureYearsMin: 10,
        roofAgeMin: 15,
        ownerRegion: "out_of_state",
        valueMax: 400000,
        residentialOnly: true,
      },
    ],
    [
      "Waterfront, long tenure, small portfolio owners",
      "Waterfront parcels held a long time by owners who are not large portfolio holders — the ones most likely to answer a letter.",
      {
        water: "waterfront",
        tenureYearsMin: 10,
        residentialOnly: true,
      },
    ],
  ];

  for (const [name, description, criteria] of starters) {
    const id = `search-${name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 40)
      .replace(/-$/, "")}`;
    await conn.run(`
      INSERT INTO saved_searches
        (search_id, name, description, where_sql, criteria_json, owner_id, notify)
      VALUES (${lit(id)}, ${lit(name)}, ${lit(description)},
              ${lit(whereFor(criteria as Criteria))}, ${lit(JSON.stringify(criteria))},
              'u-dana', true)
    `);
  }
}

/**
 * Find the schema file.
 *
 * Next's standalone output puts the app under `apps/web/` while the process
 * runs from the image root, so the path differs between `next start` locally
 * and the deployed container. Both are tried, and a missing file throws rather
 * than falling back to an empty schema — a CRM that starts with no tables would
 * fail later, further from the cause, on a page the user is looking at.
 */
function readSchema(): string {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "schema.sql"),
    path.join(process.cwd(), "apps", "web", "src", "lib", "schema.sql"),
    path.join(import.meta.dirname ?? "", "schema.sql"),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, "utf8");
    }
  }
  throw new Error(
    `Could not find schema.sql. Looked in: ${candidates.join(", ")}. ` +
      `The Dockerfile must copy apps/web/src/lib/schema.sql into the runtime image.`,
  );
}
