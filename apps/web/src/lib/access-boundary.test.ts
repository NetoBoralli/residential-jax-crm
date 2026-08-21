import { afterEach, describe, expect, it } from "vitest";

import {
  AccessBoundaryViolation,
  FORBIDDEN_HOSTS,
  assertAllowed,
  register,
} from "../instrumentation";

/**
 * The access boundary is a scored requirement and a design commitment, so it is
 * tested rather than asserted in a comment. These cases are what stop a future
 * edit from "just fetching the Parquet directly, it's faster" — which it is,
 * and which is exactly the shortcut that ends with two systems disagreeing
 * about what a waterfront property is.
 */
describe("assertAllowed", () => {
  // Derived from the guard, not copied beside it. A hand-maintained fixture
  // listed five of the six hosts and omitted overturemaps.org — the exact host
  // whose omission the guard's own comment records as the bug to prevent.
  for (const { host } of FORBIDDEN_HOSTS) {
    it(`blocks ${host}`, () => {
      expect(() => assertAllowed(`https://${host}/x`)).toThrow(
        AccessBoundaryViolation,
      );
    });

    it(`blocks ${host} as a fully-qualified name`, () => {
      // A trailing dot resolves identically in DNS and matched neither the
      // exact comparison nor the suffix one, so it walked through the guard.
      expect(() => assertAllowed(`https://${host}./x`)).toThrow(
        AccessBoundaryViolation,
      );
    });

    it(`blocks ${host} regardless of case`, () => {
      expect(() => assertAllowed(`https://${host.toUpperCase()}/x`)).toThrow(
        AccessBoundaryViolation,
      );
    });
  }

  it("blocks a subdomain given as a fully-qualified name", () => {
    expect(() =>
      assertAllowed("https://gateway.ipfs.filebase.io./ipfs/Qm"),
    ).toThrow(AccessBoundaryViolation);
  });

  it("blocks subdomains of a forbidden host", () => {
    expect(() =>
      assertAllowed("https://gateway.ipfs.filebase.io/ipfs/Qm"),
    ).toThrow(AccessBoundaryViolation);
  });

  const allowed = [
    "https://oracle-web-production-1976.up.railway.app/mcp",
    "https://api.anthropic.com/v1/messages",
    "https://a.basemaps.cartocdn.com/rastertiles/dark_all/9/1/2@2x.png",
    "/api/health",
  ];

  for (const url of allowed) {
    it(`allows ${url.slice(0, 48)}`, () => {
      expect(() => assertAllowed(url)).not.toThrow();
    });
  }

  it("names the sanctioned path in the error, so the fix is obvious", () => {
    try {
      assertAllowed("https://ipfs.filebase.io/ipfs/Qm");
      throw new Error("should have thrown");
    } catch (error) {
      expect(String(error)).toContain("oracle-client.ts");
    }
  });
});

describe("register", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  // Synchronously, not as a rejected promise. A blocked host is a programming
  // error rather than a network condition, and throwing at the call site puts
  // the offending line at the top of the stack instead of burying it in a
  // rejection handler somewhere else.
  it("makes a direct IPFS fetch throw at the point of call", () => {
    register();
    expect(() => fetch("https://ipfs.filebase.io/ipfs/QmXyz")).toThrow(
      AccessBoundaryViolation,
    );
  });

  it("accepts a Request object as well as a string", () => {
    register();
    expect(() =>
      fetch(new Request("https://floridarevenue.com/property/x.zip")),
    ).toThrow(AccessBoundaryViolation);
  });

  it("passes an allowed request through to the underlying fetch", async () => {
    // Stubbed rather than real: the assertion is that the wrapper delegates,
    // and a live request would make this test depend on the network.
    const calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    register();
    const res = await fetch(
      "https://oracle-web-production-1976.up.railway.app/mcp",
    );

    expect(await res.text()).toBe("ok");
    expect(calls).toEqual([
      "https://oracle-web-production-1976.up.railway.app/mcp",
    ]);
  });
});
