import { describe, expect, it } from "vitest";

import { all, lit, run, withTransaction } from "./db";

/**
 * The transaction must not touch the shared connection.
 *
 * DuckDB scopes transactions to a connection, and this app shares one across
 * every request. Opening a transaction on it meant an unrelated write that
 * merely interleaved — a note added while an alert sweep ran — joined that
 * transaction and was destroyed by its rollback, after the user had already
 * been told it saved. Two overlapping sweeps were worse: the second BEGIN
 * throws "cannot start a transaction within a transaction", and its rollback
 * aborts the first.
 *
 * These reproduce both, and would both fail against the previous version.
 */
describe("transaction isolation", () => {
  it("does not roll back an unrelated write that interleaves", async () => {
    await run(`CREATE TABLE IF NOT EXISTS tx_probe (id TEXT, tag TEXT)`);
    await run(`DELETE FROM tx_probe`);

    const failing = withTransaction(async (tx) => {
      await tx.run(`INSERT INTO tx_probe VALUES ('inside', 'sweep')`);
      // Yield, so the unrelated write lands mid-transaction.
      await new Promise((r) => setTimeout(r, 20));
      throw new Error("sweep failed partway, as it can");
    });

    await new Promise((r) => setTimeout(r, 5));
    await run(
      `INSERT INTO tx_probe VALUES ('outside', ${lit("a user's note")})`,
    );

    await expect(failing).rejects.toThrow(/sweep failed/);

    const rows = await all<{ id: string }>(`SELECT id FROM tx_probe`);
    const ids = rows.map((r) => r.id);
    // The sweep's own row is gone, as it should be.
    expect(ids).not.toContain("inside");
    // The bystander's row survived. This is the assertion that matters.
    expect(ids).toContain("outside");
  });

  it("allows two transactions to overlap without destroying each other", async () => {
    await run(`CREATE TABLE IF NOT EXISTS tx_overlap (id TEXT)`);
    await run(`DELETE FROM tx_overlap`);

    const one = withTransaction(async (tx) => {
      await tx.run(`INSERT INTO tx_overlap VALUES ('first')`);
      await new Promise((r) => setTimeout(r, 25));
      await tx.run(`INSERT INTO tx_overlap VALUES ('first-second-row')`);
    });
    const two = withTransaction(async (tx) => {
      await new Promise((r) => setTimeout(r, 5));
      await tx.run(`INSERT INTO tx_overlap VALUES ('second')`);
    });

    await Promise.all([one, two]);

    const ids = (await all<{ id: string }>(`SELECT id FROM tx_overlap`)).map(
      (r) => r.id,
    );
    expect(ids.sort()).toEqual(["first", "first-second-row", "second"]);
  });

  it("commits everything or nothing", async () => {
    await run(`CREATE TABLE IF NOT EXISTS tx_atomic (id TEXT)`);
    await run(`DELETE FROM tx_atomic`);

    await expect(
      withTransaction(async (tx) => {
        await tx.run(`INSERT INTO tx_atomic VALUES ('a')`);
        await tx.run(`INSERT INTO tx_atomic VALUES ('b')`);
        await tx.run(`INSERT INTO tx_atomic VALUES (this is not sql)`);
      }),
    ).rejects.toThrow();

    expect(await all(`SELECT * FROM tx_atomic`)).toEqual([]);
  });
});
