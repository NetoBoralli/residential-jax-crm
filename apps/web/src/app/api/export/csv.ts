/**
 * One CSV cell.
 *
 * Extracted so it can be tested. It has been wrong in production twice in
 * opposite directions — see the tests — which is a strong argument for a pure
 * function with an exact-output table rather than a regex inline in a route.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  // Guard on whether the cell is a number, not on its first character. A
  // leading =, +, - or @ makes a cell a formula in Excel, but "-81.65" is a
  // longitude and "+1904555" is a phone number. Anything that parses as a
  // number passes through; anything else that starts like a formula is quoted.
  if (!Number.isFinite(Number(s)) && /^[=+@\-\t\r]/.test(s)) s = `'${s}`;

  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
