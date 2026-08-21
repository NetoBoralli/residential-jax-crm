import { describe, expect, it } from "vitest";

import { Answer } from "@/components/answer";

/**
 * The agent replies in Markdown and the page renders it. Printed verbatim it
 * arrived with visible asterisks and literal pipes on the page the product is
 * judged by, so what the parser does and does not handle is worth pinning.
 */
function render(text: string): string {
  // Walk the element tree the component returns and describe its shape,
  // without needing a DOM.
  const seen: string[] = [];
  const walk = (node: unknown): void => {
    if (node === null || node === undefined || typeof node === "boolean")
      return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (
      typeof node === "object" &&
      "type" in (node as Record<string, unknown>)
    ) {
      const el = node as { type: unknown; props?: { children?: unknown } };
      if (typeof el.type === "string") seen.push(el.type);
      walk(el.props?.children);
      return;
    }
    seen.push(`text:${String(node)}`);
  };
  walk(Answer({ text }));
  return seen.join(" ");
}

describe("Answer", () => {
  it("renders bold as an element rather than asterisks", () => {
    const out = render("**904 properties** match.");
    expect(out).toContain("strong");
    expect(out).not.toContain("**");
  });

  it("renders inline code without backticks", () => {
    const out = render("Filter on `owner_region_class`.");
    expect(out).toContain("code");
    expect(out).not.toContain("`");
  });

  it("renders a pipe table as a table", () => {
    const out = render(
      ["| Folio | Address |", "|---|---|", "| 123R | 1 MAIN ST |"].join("\n"),
    );
    expect(out).toContain("table");
    expect(out).toContain("thead");
    expect(out).toContain("th");
    expect(out).toContain("text:Folio");
    expect(out).toContain("text:1 MAIN ST");
    // The divider row must never become a data row.
    expect(out).not.toContain("text:---");
  });

  it("renders bullets and numbered lists as lists", () => {
    expect(render("- one\n- two")).toContain("ul");
    expect(render("1. first\n2. second")).toContain("ol");
  });

  it("renders a heading as a heading, not a hash", () => {
    const out = render("## Basis");
    expect(out).toContain("h3");
    expect(out).not.toContain("##");
  });

  it("leaves ordinary prose as paragraphs", () => {
    const out = render("Two sentences.\n\nA second paragraph.");
    expect(out.match(/\bp\b/g)?.length).toBe(2);
  });
});
