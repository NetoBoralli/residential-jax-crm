/**
 * Quoting for SQL that is sent to the Duval Oracle rather than run locally.
 *
 * `lit()` in db.ts owns values reaching the CRM's own DuckDB. This is the same
 * job for the other direction: folios and identifiers interpolated into a
 * SELECT that the Oracle will parse and execute. Kept separate because the two
 * have different blast radii and may need to diverge — but neither should ever
 * be re-implemented inline at a call site, which is how the invariant stops
 * being an invariant.
 *
 * The Oracle validates every statement against its own parse tree before
 * running it, so this is defence in depth rather than the only guard. It is
 * still the one that keeps a folio containing an apostrophe from being a
 * syntax error.
 */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
