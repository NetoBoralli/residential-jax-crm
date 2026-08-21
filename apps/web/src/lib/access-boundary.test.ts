import { afterEach, describe, expect, it } from "vitest";

import {
  AccessBoundaryViolation,
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
  const blocked = [
    "https://ipfs.filebase.io/ipfs/QmXyz/query-table.parquet",
    "https://s3.filebase.io/elephant-oracle-query-table-duval/x.parquet",
    "https://api.filebase.io/v1/names/oracle-query-table-duval",
    "https://floridarevenue.com/property/dataportal/Documents/x.zip",
    "https://overturemaps-us-west-2.s3.amazonaws.com/release/x.parquet",
  ];

  for (const url of blocked) {
    it(`blocks ${new URL(url).hostname}`, () => {
      expect(() => assertAllowed(url)).toThrow(AccessBoundaryViolation);
    });
  }

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

  it("still lets the sanctioned endpoint through after wrapping", () => {
    register();
    // Guard passes; the call then fails on DNS, which is a different error.
    expect(() => fetch("https://oracle.invalid.test/mcp")).not.toThrow(
      AccessBoundaryViolation,
    );
  });
});
