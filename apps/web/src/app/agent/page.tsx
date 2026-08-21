import { headers } from "next/headers";
import Link from "next/link";

import { askAgent } from "@/lib/agent";
import { clientKey, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const EXAMPLES = [
  "Show distressed residential properties in Arlington with roofs older than 15 years that have not sold in 10+ years",
  "How many waterfront homes under $400,000 have out-of-state owners?",
  "Which owners hold the most Duval parcels, and what are those parcels worth in total?",
  "What changed in the most recent pipeline run?",
  "What is in our acquisition pipeline right now?",
];

export default async function AgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const question = typeof sp["q"] === "string" ? sp["q"].trim() : "";

  let answer: Awaited<ReturnType<typeof askAgent>> | undefined;
  let error: string | undefined;

  if (question) {
    const limit = rateLimit(clientKey(await headers(), "crm-agent"), {
      limit: 10,
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      error = `Too many questions from this address. The agent is limited to 10 per minute because each call spends model tokens; try again in ${limit.retryAfterSeconds}s.`;
    } else {
      try {
        answer = await askAgent(question);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
  }

  return (
    <>
      <h1>Ask about Duval</h1>
      <p className="lede">
        Natural-language access to the same data the rest of this CRM uses. The
        agent reaches the county dataset only through the Duval Oracle&rsquo;s
        MCP tools, and it cannot state a number it did not retrieve — every
        query it ran is shown with the answer.
      </p>

      <form
        method="get"
        className="card"
        style={{ marginTop: 20 }}
        data-testid="agent-form"
      >
        <label htmlFor="q">
          <span className="subtle">Your question</span>
          <input
            id="q"
            name="q"
            defaultValue={question}
            placeholder={EXAMPLES[0]}
            aria-label="Question"
            style={{
              width: "100%",
              marginTop: 8,
              background: "var(--bg-sunken)",
              color: "var(--fg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: "inherit",
              fontSize: "0.95rem",
            }}
          />
        </label>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <button className="btn" type="submit" data-testid="agent-submit">
            Ask
          </button>
          <span className="subtle">
            Takes 10–40 seconds — the agent runs several queries against 404,023
            parcels before answering.
          </span>
        </div>
      </form>

      <section style={{ marginTop: 18 }}>
        <h3>Try one of these</h3>
        <div className="row-actions" style={{ marginTop: 10 }}>
          {EXAMPLES.map((e) => (
            <Link
              key={e}
              className="btn btn-secondary"
              href={`/agent?q=${encodeURIComponent(e)}`}
              data-testid="agent-example"
            >
              {e.length > 62 ? `${e.slice(0, 62)}…` : e}
            </Link>
          ))}
        </div>
      </section>

      {error ? (
        <div
          className="card"
          style={{ marginTop: 24, borderColor: "var(--border-strong)" }}
          data-testid="agent-error"
        >
          <h3>
            <span className="badge badge-warn">Could not answer</span>
          </h3>
          <pre
            className="mono subtle"
            style={{ marginTop: 10, whiteSpace: "pre-wrap" }}
          >
            {error}
          </pre>
        </div>
      ) : null}

      {answer ? (
        <>
          <section
            className="card"
            style={{ marginTop: 24 }}
            data-testid="agent-answer"
          >
            <h2 style={{ marginTop: 0 }}>Answer</h2>
            <div
              style={{ whiteSpace: "pre-wrap", marginTop: 10, lineHeight: 1.6 }}
              data-testid="agent-answer-text"
            >
              {answer.text}
            </div>
          </section>

          <section style={{ marginTop: 22 }}>
            <h2>How it got there</h2>
            <p className="muted">
              {answer.steps.length} tool{" "}
              {answer.steps.length === 1 ? "call" : "calls"} in{" "}
              {(answer.durationMs / 1000).toFixed(1)} s, answered by{" "}
              <span className="mono">{answer.model}</span>.
            </p>
            <table style={{ marginTop: 10 }} data-testid="agent-steps">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Result</th>
                  <th>Query</th>
                </tr>
              </thead>
              <tbody>
                {answer.steps.map((s, i) => (
                  <tr key={i} data-testid="agent-step">
                    <td className="mono">{s.tool}</td>
                    <td>{s.summary}</td>
                    <td>
                      {s.detail ? (
                        <pre
                          className="mono subtle"
                          style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            fontSize: "0.75rem",
                          }}
                        >
                          {s.detail}
                        </pre>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </>
  );
}
