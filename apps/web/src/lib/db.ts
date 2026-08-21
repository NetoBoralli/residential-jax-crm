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
let engine: DuckDBInstance | undefined;
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
  // Repair, not just prevention. Deleting a saved search used to leave its
  // alerts behind, and an orphaned alert renders a raw id linking to a 404 —
  // which is worse than no alert, because the whole value of one is naming the
  // criteria it matched. deleteSearch now cascades; this clears what it left.
  `DELETE FROM notification_matches
    WHERE notification_id IN (
      SELECT n.notification_id FROM notifications n
       WHERE NOT EXISTS (
         SELECT 1 FROM saved_searches s WHERE s.search_id = n.search_id
       ))`,
  `DELETE FROM notifications n
    WHERE NOT EXISTS (
      SELECT 1 FROM saved_searches s WHERE s.search_id = n.search_id
    )`,
];

/**
 * Open the store, recovering from a write-ahead log the engine cannot replay.
 *
 * A container killed mid-write — which is every redeploy — can leave a WAL that
 * DuckDB refuses to replay on the next boot, and the process then fails every
 * request with an internal error. That is the honest cost of a file on a volume
 * and ADR 001 now says so.
 *
 * Recovery is possible here specifically because this store holds workspace
 * state and nothing irreplaceable: the criteria sets are seeded and the alerts
 * are recomputed from published pipeline runs in one call. The damaged files
 * are moved aside rather than deleted, so nothing is destroyed and the failure
 * can still be examined, and the app comes back up instead of staying down.
 */
let quarantinedThisProcess = false;

async function openOrRecover(): Promise<DuckDBConnection> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Only opening the file is recoverable.
  //
  // The first version wrapped schema, migrations and seeding in this try too —
  // so a migration that was merely *wrong* (DuckDB rejects adding a NOT NULL
  // column to a populated table) renamed a perfectly healthy database aside
  // and started an empty one. Worse, `db()` clears `opening` in its finally,
  // so every subsequent request retried and quarantined again, leaving a pile
  // of `.corrupt-*` files and leaked instances. A bad migration must take the
  // deploy down loudly with the store intact; that is a far better failure
  // than silently replacing a team's workspace.
  let instance: DuckDBInstance;
  try {
    instance = await DuckDBInstance.create(DB_FILE);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Once per process. Retrying the quarantine on every request produced a
    // new `.corrupt-*` file each time.
    if (quarantinedThisProcess) throw error;
    quarantinedThisProcess = true;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    for (const suffix of ["", ".wal"]) {
      const from = `${DB_FILE}${suffix}`;
      if (fs.existsSync(from)) {
        fs.renameSync(from, `${from}.corrupt-${stamp}`);
      }
    }
    console.error(
      `[crm-db] Could not open ${DB_FILE}: ${reason}\n` +
        `[crm-db] Moved it aside as ${DB_FILE}.corrupt-${stamp} and started a new store. ` +
        `Saved criteria reseed automatically; re-run /api/alerts/check to recompute alerts. ` +
        `Opportunities and outreach recorded in the damaged file are not recovered.`,
    );
    instance = await DuckDBInstance.create(DB_FILE);
  }

  // Outside the recovery try on purpose — see above.
  return prepare(instance);
}

async function prepare(instance: DuckDBInstance): Promise<DuckDBConnection> {
  const conn = await instance.connect();

  for (const stmt of statements(readSchema())) await conn.run(stmt);
  for (const stmt of MIGRATIONS) await conn.run(stmt);

  await seed(conn);
  closeOnShutdown(instance, conn);
  engine = instance;
  return conn;
}

/**
 * Close cleanly on SIGTERM so a redeploy does not leave a WAL behind.
 *
 * This makes the recovery path above rare rather than routine. Railway sends
 * SIGTERM before SIGKILL, which is enough time to checkpoint.
 */
let shutdownHooked = false;
function closeOnShutdown(
  instance: DuckDBInstance,
  conn: DuckDBConnection,
): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const close = () => {
    try {
      conn.closeSync();
      instance.closeSync();
    } catch {
      // Shutting down anyway; a failure here has nowhere useful to go.
    }
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
}

export async function db(): Promise<DuckDBConnection> {
  if (connection) return connection;
  if (!opening) {
    opening = openOrRecover().then((c) => {
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

/**
 * Run a unit of work in a transaction, on its own connection.
 *
 * DuckDB scopes transactions to a connection, and this app shares one
 * connection across every request. Opening a transaction on it meant an
 * unrelated write that merely *interleaved* — a note being added while an alert
 * sweep ran — joined that transaction and was destroyed by its ROLLBACK, after
 * the user had already been told it saved. Two overlapping sweeps were worse
 * still: the second `BEGIN` throws "cannot start a transaction within a
 * transaction", and its rollback aborts the first.
 *
 * Connections are cheap and share the instance's catalog, so a dedicated one
 * per transaction isolates the unit of work without a second database.
 */
export async function withTransaction<T>(
  work: (tx: {
    run: (sql: string) => Promise<void>;
    all: <R = Record<string, unknown>>(sql: string) => Promise<R[]>;
  }) => Promise<T>,
): Promise<T> {
  await db();
  if (!engine) throw new Error("The CRM store is not initialised.");

  const conn = await engine.connect();
  const tx = {
    run: async (sql: string) => {
      await conn.run(sql);
    },
    all: async <R = Record<string, unknown>>(sql: string): Promise<R[]> => {
      const reader = await conn.runAndReadAll(sql);
      return normalise(reader.getRowObjects()) as R[];
    },
  };

  try {
    await conn.run("BEGIN TRANSACTION");
    const result = await work(tx);
    await conn.run("COMMIT");
    return result;
  } catch (error) {
    await conn.run("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    try {
      conn.closeSync();
    } catch {
      // Already closed, or closing raced the rollback.
    }
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

/**
 * DuckDB value classes whose whole meaning is their string form.
 *
 * Deliberately not "anything with a custom prototype" — DuckDBStructValue and
 * DuckDBListValue are class instances too, and they are containers whose
 * contents must still be walked.
 */
const SCALAR_VALUE_CLASS =
  /^DuckDB(Timestamp\w*|Date|Time\w*|Interval|Decimal|UUID|Bit|Blob)Value$/;

function normalise(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    // DuckDB hands back class instances for temporal and decimal columns —
    // DuckDBTimestampTZValue, DuckDBDateValue, DuckDBDecimalValue — whose
    // meaning lives in toString(). Recursing into them as if they were plain
    // rows rebuilt them field by field and threw the value away: every
    // timestamp in the app rendered as a dash, and every one in a CSV export
    // as "[object Object]".
    //
    // Matched by name rather than by "is a class instance": a STRUCT or LIST
    // column is also a class instance, and stringifying those would trade one
    // silent data loss for another.
    if (SCALAR_VALUE_CLASS.test(value.constructor?.name ?? "")) {
      return String(value);
    }
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
