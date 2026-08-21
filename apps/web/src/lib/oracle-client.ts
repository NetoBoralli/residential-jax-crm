import "server-only";

/**
 * The only way this application reaches Duval County property data.
 *
 * The CRM does not read the Elephant IPFS artifacts, does not query the
 * pipeline's DuckDB warehouse, and does not fetch the Florida DOR or Overture
 * sources. It asks the Oracle pipeline's MCP server, which owns every
 * derivation and every caveat that comes with it. That boundary is the point:
 * if the CRM could reach the underlying data directly it would inevitably grow
 * its own copy of the derivation logic, and the two systems would start
 * disagreeing about what "waterfront" or "roof age" means.
 *
 * The boundary is enforced three ways, so it survives a careless edit:
 *   1. This is the only module that constructs a request to the Oracle.
 *   2. `instrumentation.ts` installs a fetch guard that throws on any request
 *      to an upstream data host, from anywhere in the process.
 *   3. `access-boundary.test.ts` asserts the guard actually fires.
 */

const ORACLE_MCP_URL =
  process.env["ORACLE_MCP_URL"] ??
  "https://oracle-web-production-1976.up.railway.app/mcp";

export const ORACLE_ENDPOINT = ORACLE_MCP_URL;

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: {
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
    tools?: Array<{ name: string; description: string }>;
  };
  error?: { code: number; message: string };
}

let nextId = 1;

/**
 * One MCP tool call.
 *
 * Errors are surfaced rather than swallowed. A CRM that silently renders an
 * empty list when its data source is unreachable teaches its users to trust an
 * empty list, which is worse than showing them that something is broken.
 */
export async function callOracle<T>(
  tool: string,
  args: Record<string, unknown> = {},
  opts: { revalidate?: number; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? 60_000,
  );

  try {
    const res = await fetch(ORACLE_MCP_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method: "tools/call",
        params: { name: tool, arguments: args },
      }),
      signal: controller.signal,
      ...(opts.revalidate === undefined
        ? { cache: "no-store" as const }
        : { next: { revalidate: opts.revalidate } }),
    });

    if (!res.ok) {
      throw new OracleUnavailable(
        `The Duval Oracle MCP returned HTTP ${res.status} for ${tool}.`,
      );
    }

    const body = (await res.json()) as JsonRpcResponse;
    if (body.error) {
      throw new OracleUnavailable(
        `The Duval Oracle rejected ${tool}: ${body.error.message}`,
      );
    }

    const text = body.result?.content?.[0]?.text;
    if (body.result?.isError) {
      throw new OracleUnavailable(
        `The Duval Oracle could not answer ${tool}: ${text ?? "no detail given"}`,
      );
    }
    if (!text) {
      throw new OracleUnavailable(
        `The Duval Oracle returned no content for ${tool}.`,
      );
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof OracleUnavailable) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OracleUnavailable(
        `The Duval Oracle did not respond to ${tool} within the timeout.`,
      );
    }
    throw new OracleUnavailable(
      `Could not reach the Duval Oracle for ${tool}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export class OracleUnavailable extends Error {
  override readonly name = "OracleUnavailable";
}

/** Which tools the Oracle currently offers — shown on the integration page. */
export async function listOracleTools(): Promise<
  Array<{ name: string; description: string }>
> {
  const res = await fetch(ORACLE_MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: nextId++,
      method: "tools/list",
    }),
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new OracleUnavailable(`tools/list returned ${res.status}`);
  const body = (await res.json()) as JsonRpcResponse;
  return body.result?.tools ?? [];
}

// ---------------------------------------------------------------------------
// Typed views over the Oracle's tools. Everything the CRM knows about a Duval
// property arrives through one of these.
// ---------------------------------------------------------------------------

export interface OracleProperty {
  request_identifier: string;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  owner_name: string | null;
  market_value: number | null;
  assessed_value: number | null;
  latitude: number | null;
  longitude: number | null;
  [key: string]: unknown;
}

export interface OracleQueryResult {
  rows: OracleProperty[];
  rowCount: number;
  sql: string;
  durationMs: number;
  provenance: Record<string, unknown>;
}

export function queryProperties(
  sql: string,
  limit = 100,
): Promise<OracleQueryResult> {
  return callOracle<OracleQueryResult>("queryProperties", {
    county: "duval",
    sql,
    limit,
  });
}

export interface DatasetInfo {
  county: string;
  countyName?: string;
  stateCode?: string;
  view?: string;
  /** The Oracle's own field name. Calling it `counts` here made every read of
   *  it undefined, and the index signature meant the compiler never said so —
   *  the dashboard's headline number rendered as a dash. */
  totals: Record<string, number>;
  pointer?: {
    ipnsName: string;
    ipnsUrl: string;
    cid: string;
    cidUrl: string;
    resolvedFrom: string;
  };
  [key: string]: unknown;
}

export function getDatasetInfo(): Promise<DatasetInfo> {
  return callOracle<DatasetInfo>("getDatasetInfo", {}, { revalidate: 120 });
}

export interface OracleRun {
  run_id: string;
  mode: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  inserts: number;
  updates: number;
  deletes: number;
  records_in: number;
  duration_ms: number | null;
  [key: string]: unknown;
}

export function listPipelineRuns(limit = 25): Promise<{ runs: OracleRun[] }> {
  return callOracle<{ runs: OracleRun[] }>(
    "listPipelineRuns",
    { limit },
    { revalidate: 60 },
  );
}

export interface ChangeMatch {
  runId: string;
  changedInRun: number;
  matched: number;
  rows: OracleProperty[];
  changesCid: string;
  changesUrl: string;
  provenance: Record<string, unknown>;
}

/** The notification path: what changed in this run that matches these criteria. */
export function matchChangedProperties(opts: {
  runId: string;
  where?: string;
  deltaTypes?: string[];
  limit?: number;
}): Promise<ChangeMatch> {
  return callOracle<ChangeMatch>("matchChangedProperties", {
    run_id: opts.runId,
    where: opts.where,
    delta_types: opts.deltaTypes,
    limit: opts.limit ?? 50,
  });
}

export interface StandardQuestion {
  slug: string;
  title: string;
  prompt: string;
  basis: string;
  caveat: string;
}

export function listStandardQuestions(): Promise<{
  questions: StandardQuestion[];
}> {
  return callOracle<{ questions: StandardQuestion[] }>(
    "listStandardQuestions",
    {},
    { revalidate: 3600 },
  );
}

export function getPropertyQuerySchema(): Promise<{
  columns: Array<{ name: string; type: string }>;
}> {
  return callOracle<{ columns: Array<{ name: string; type: string }> }>(
    "getPropertyQuerySchema",
    { county: "duval" },
    { revalidate: 3600 },
  );
}
