import type { ReactNode } from "react";

/**
 * Render the agent's answer.
 *
 * The model replies in Markdown, and the page used to print it verbatim inside
 * `white-space: pre-wrap` — so the headline figure arrived wrapped in visible
 * asterisks and the caveats were a run of literal hyphens. On the page the
 * whole product is judged by, that reads as a debug dump.
 *
 * This is deliberately not a Markdown library. It handles what this agent
 * actually emits — paragraphs, bold, inline code, bullet and numbered lists,
 * headings, and pipe tables when it lists properties — and anything it does
 * not recognise falls through as plain text, which is the safe direction. A
 * dependency plus a sanitiser is a worse trade for six constructs.
 */

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  // Bold and inline code in one pass, so neither can swallow the other.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      out.push(
        <code key={key++} className="mono">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = match.index + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string): string[] =>
  row
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

/** A `|---|:---:|` row: the line that makes the one above it a header. */
const isDivider = (row: string): boolean =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(row) && row.includes("-");

const isTableRow = (row: string): boolean => row.trim().startsWith("|");

export function Answer({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let key = 0;

  let bullets: string[] = [];
  let ordered: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul-${key++}`} className="answer-list">
        {bullets.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  const flushOrdered = () => {
    if (!ordered.length) return;
    blocks.push(
      <ol key={`ol-${key++}`} className="answer-list">
        {ordered.map((b, i) => (
          <li key={i}>{inline(b)}</li>
        ))}
      </ol>,
    );
    ordered = [];
  };
  const flushLists = () => {
    flushBullets();
    flushOrdered();
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const line = raw.trim();

    if (line === "") {
      flushLists();
      continue;
    }

    // A pipe table. Rendered as a real table so a property list is scannable
    // rather than a wall of pipes — which is exactly how it used to arrive.
    if (isTableRow(line)) {
      flushLists();
      const rows: string[] = [];
      while (i < lines.length && isTableRow((lines[i] ?? "").trim())) {
        rows.push((lines[i] ?? "").trim());
        i += 1;
      }
      i -= 1;

      const hasHeader = rows.length > 1 && isDivider(rows[1] ?? "");
      const header = hasHeader ? cells(rows[0] ?? "") : undefined;
      const body = rows.slice(hasHeader ? 2 : 0).filter((r) => !isDivider(r));

      blocks.push(
        <div key={`tbl-${key++}`} className="table-scroll">
          <table>
            {header ? (
              <thead>
                <tr>
                  {header.map((h, hi) => (
                    <th key={hi}>{inline(h)}</th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {body.map((r, ri) => (
                <tr key={ri}>
                  {cells(r).map((c, ci) => (
                    <td key={ci}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[2]) {
      flushLists();
      blocks.push(
        <h3 key={`h-${key++}`} className="answer-heading">
          {inline(heading[2])}
        </h3>,
      );
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered?.[1]) {
      flushBullets();
      ordered.push(numbered[1]);
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      flushOrdered();
      bullets.push(bullet[1]);
      continue;
    }

    flushLists();
    blocks.push(<p key={`p-${key++}`}>{inline(line)}</p>);
  }
  flushLists();

  return (
    <div className="answer" data-testid="agent-answer-text">
      {blocks}
    </div>
  );
}
