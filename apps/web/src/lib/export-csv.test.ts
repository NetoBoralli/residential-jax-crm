import { describe, expect, it } from "vitest";

import { csvCell } from "@/app/api/export/csv";

/**
 * The spreadsheet-formula guard has been wrong in production twice, in
 * opposite directions, and it is two lines of pure logic.
 *
 * First version guarded every leading `-` and turned every longitude in the
 * county into text — the one column a mapping tool needs. Second version
 * exempted `-` followed by a digit, which is exactly the shape of the standard
 * DDE payload, so it shipped a live command into a file the product tells an
 * analyst to open.
 */
describe("csvCell", () => {
  it("leaves numbers alone, including negative coordinates", () => {
    for (const value of ["-81.6557", "30.3452", "0", "-0.5", "142175", "-2"]) {
      expect(csvCell(value)).toBe(value);
    }
  });

  it("neutralises formulas that are not numbers", () => {
    // Prefixed *and* quoted: it starts like a formula and contains a quote, so
    // both rules apply and the inner quotes are doubled.
    expect(csvCell('=HYPERLINK("http://x")')).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    );
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+1904555")).toBe("+1904555");
    // The payload the second version let through.
    expect(csvCell("-2+3+cmd|' /C calc.exe'!A0")).toBe(
      "'-2+3+cmd|' /C calc.exe'!A0",
    );
    expect(csvCell("-SUM(A1)")).toBe("'-SUM(A1)");
  });

  it("quotes and escapes cells containing a comma, quote or newline", () => {
    expect(csvCell("SMITH, JOHN")).toBe('"SMITH, JOHN"');
    expect(csvCell('O"BRIEN')).toBe('"O""BRIEN"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders absent values as empty rather than as text", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });
});
