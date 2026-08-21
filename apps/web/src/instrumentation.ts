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

/**
 * The blocked hosts, with why each one is blocked.
 *
 * Exported because /integration renders this list to prove the boundary
 * exists. It previously kept its own copy, which drifted immediately: the page
 * told a reviewer five hosts were blocked while the guard blocked six, and
 * omitted overturemaps.org — the exact fact the page exists to demonstrate.
 */
export const FORBIDDEN_HOSTS: Array<{ host: string; why: string }> = [
  {
    host: "ipfs.filebase.io",
    why: "The published artifacts. Reading them directly skips the Oracle's derivations and the caveats that bound them.",
  },
  {
    host: "s3.filebase.io",
    why: "The object store behind those artifacts.",
  },
  {
    host: "api.filebase.io",
    why: "IPNS control. The CRM has no business moving a pointer it does not own.",
  },
  {
    host: "floridarevenue.com",
    why: "The raw Florida DOR tax roll. Re-deriving from source is exactly the duplication this boundary prevents.",
  },
  {
    host: "overturemaps-us-west-2.s3.amazonaws.com",
    why: "Raw Overture Places and water, as the pipeline reads them.",
  },
  {
    host: "overturemaps.org",
    why: "Overture's own distribution. Same reason as the S3 bucket.",
  },
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
    ({ host: h }) => host === h || host.endsWith(`.${h}`),
  );
  if (blocked) {
    throw new AccessBoundaryViolation(
      `Blocked a direct request to ${host}. This CRM must read Duval property data through the Oracle pipeline's MCP surface (lib/oracle-client.ts), not from ${blocked.host} directly — see docs/access-boundaries.md.`,
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
