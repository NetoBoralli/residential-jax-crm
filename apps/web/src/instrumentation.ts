/**
 * Access-boundary enforcement.
 *
 * The assignment requires that this CRM consume Duval data through the Oracle
 * pipeline's published tool surface rather than by reaching around it. A code
 * review can assert that; a running process can prove it. This wraps `fetch`
 * for the whole server runtime and throws on any request to a host that is
 * upstream of the Oracle.
 *
 * It throws synchronously rather than returning a rejected promise: a request
 * to a blocked host is a programming error, not a network condition, so the
 * offending call belongs at the top of the stack.
 *
 * It is deliberately a hard failure rather than a warning. A warning would be
 * ignored under deadline, and the first direct IPFS read would quietly become
 * permanent — at which point the CRM owns a second, divergent copy of every
 * derivation the pipeline already makes.
 *
 * The Oracle's own MCP host is not on this list; that is the sanctioned path.
 */

const FORBIDDEN_HOSTS = [
  "ipfs.filebase.io",
  "s3.filebase.io",
  "api.filebase.io",
  "floridarevenue.com",
  "overturemaps-us-west-2.s3.amazonaws.com",
  "overturemaps.org",
];

export class AccessBoundaryViolation extends Error {
  override readonly name = "AccessBoundaryViolation";
}

export function assertAllowed(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return; // Relative URLs never leave the app.
  }
  const blocked = FORBIDDEN_HOSTS.find(
    (h) => host === h || host.endsWith(`.${h}`),
  );
  if (blocked) {
    throw new AccessBoundaryViolation(
      `Blocked a direct request to ${host}. This CRM must read Duval property data through the Oracle pipeline's MCP surface (lib/oracle-client.ts), not from ${blocked} directly — see docs/access-boundaries.md.`,
    );
  }
}

export function register(): void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    assertAllowed(url);
    return original(input as RequestInfo, init);
  }) as typeof fetch;
}
