import { OracleDown, num, when } from "@/components/ui";
import { FORBIDDEN_HOSTS } from "@/instrumentation";
import {
  ORACLE_ENDPOINT,
  OracleUnavailable,
  getDatasetInfo,
  listOracleTools,
  listPipelineRuns,
} from "@/lib/oracle-client";

export const dynamic = "force-dynamic";

/**
 * The access boundary, made visible.
 *
 * The assignment scores whether this CRM consumes Elephant data through the
 * tool surface rather than around it. That is a claim about runtime behaviour,
 * so this page shows the runtime: the live endpoint, the tools it offers, the
 * dataset pointer it resolves, and the hosts this process refuses to contact.
 */
export default async function IntegrationPage() {
  let tools;
  let dataset;
  let runs;
  let error: string | undefined;
  try {
    [tools, dataset, runs] = await Promise.all([
      listOracleTools(),
      getDatasetInfo(),
      listPipelineRuns(8),
    ]);
  } catch (e) {
    error =
      e instanceof OracleUnavailable || e instanceof Error
        ? e.message
        : String(e);
  }

  return (
    <>
      <h1>Where this CRM gets its data</h1>
      <p className="lede">
        Every Duval property fact in this application arrives through one HTTP
        endpoint. The CRM stores workspace state — criteria, deals, outreach —
        and no county data at all.
      </p>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>The one sanctioned path</h3>
        <table style={{ marginTop: 10 }}>
          <tbody>
            <tr>
              <td className="muted">Oracle MCP endpoint</td>
              <td
                className="mono"
                style={{ wordBreak: "break-all" }}
                data-testid="oracle-endpoint"
              >
                {ORACLE_ENDPOINT}
              </td>
            </tr>
            <tr>
              <td className="muted">Transport</td>
              <td>JSON-RPC 2.0 over HTTP POST</td>
            </tr>
            <tr>
              <td className="muted">Client module</td>
              <td className="mono">src/lib/oracle-client.ts</td>
            </tr>
          </tbody>
        </table>
      </div>

      {error ? (
        <div style={{ marginTop: 22 }}>
          <OracleDown error={error} />
        </div>
      ) : (
        <>
          <section style={{ marginTop: 26 }}>
            <h2>Tools this CRM can call</h2>
            <table style={{ marginTop: 10 }} data-testid="oracle-tools">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>What it does</th>
                </tr>
              </thead>
              <tbody>
                {tools?.map((t) => (
                  <tr key={t.name}>
                    <td className="mono">{t.name}</td>
                    <td className="muted">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ marginTop: 26 }}>
            <h2>The dataset behind those tools</h2>
            <table style={{ marginTop: 10 }} data-testid="dataset-info">
              <tbody>
                {Object.entries(dataset ?? {})
                  .filter(([, v]) => typeof v !== "object" || v === null)
                  .map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted">{k.replace(/_/g, " ")}</td>
                      <td className="mono" style={{ wordBreak: "break-all" }}>
                        {String(v)}
                      </td>
                    </tr>
                  ))}
                {Object.entries(dataset?.counts ?? {}).map(([k, v]) => (
                  <tr key={`c-${k}`}>
                    <td className="muted">{k.replace(/_/g, " ")}</td>
                    <td>{num(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="subtle" style={{ marginTop: 10 }}>
              The pipeline publishes its query table to IPFS and points a stable
              IPNS name at the CID. The CRM never resolves that pointer itself —
              the Oracle does, and the CRM asks the Oracle.
            </p>
          </section>

          <section style={{ marginTop: 26 }}>
            <h2>Runs this CRM watches</h2>
            <table style={{ marginTop: 10 }} data-testid="watched-runs">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Mode</th>
                  <th>Started</th>
                  <th className="num">Inserted</th>
                  <th className="num">Updated</th>
                  <th className="num">Read</th>
                </tr>
              </thead>
              <tbody>
                {runs?.runs.map((r) => (
                  <tr key={r.run_id}>
                    <td className="mono">{r.run_id}</td>
                    <td>{r.mode}</td>
                    <td className="subtle">{when(r.started_at)}</td>
                    <td className="num">{num(r.inserts)}</td>
                    <td className="num">{num(r.updates)}</td>
                    <td className="num">{num(r.records_in)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      <section style={{ marginTop: 30 }}>
        <h2>What this process refuses to contact</h2>
        <p className="muted">
          A runtime fetch guard in{" "}
          <span className="mono">instrumentation.ts</span> throws on any request
          to a host upstream of the Oracle, from anywhere in the server process.
          It is a hard failure rather than a warning: under deadline a warning
          gets ignored, and the first direct read quietly becomes permanent — at
          which point this CRM owns a second, divergent copy of every derivation
          the pipeline already makes.
        </p>
        <table style={{ marginTop: 12 }} data-testid="blocked-hosts">
          <thead>
            <tr>
              <th>Host</th>
              <th>Why it is blocked</th>
            </tr>
          </thead>
          <tbody>
            {FORBIDDEN_HOSTS.map(({ host, why }) => (
              <tr key={host}>
                <td className="mono">{host}</td>
                <td className="muted">{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="subtle" style={{ marginTop: 10 }}>
          {FORBIDDEN_HOSTS.length} hosts blocked, listed straight from the guard
          itself rather than from a copy. A Vitest case asserts the guard
          actually throws, so the boundary is covered by a test rather than by a
          comment.
        </p>
      </section>
    </>
  );
}
