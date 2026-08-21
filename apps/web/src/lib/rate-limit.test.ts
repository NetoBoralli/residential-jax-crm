import { describe, expect, it } from "vitest";

import { clientKey, globalLimit, rateLimit } from "./rate-limit";

describe("rateLimit", () => {
  it("allows up to the limit and refuses the next call", () => {
    const key = `test-allow-${Math.round(performance.now())}`;
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit(key, { limit: 3, windowMs: 60_000 }).allowed).toBe(true);
    }
    const over = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("starts a fresh window once the old one expires", async () => {
    const key = `test-expiry-${Math.round(performance.now())}`;
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(true);
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(rateLimit(key, { limit: 1, windowMs: 10 }).allowed).toBe(true);
  });
});

describe("clientKey under a spoofed forwarding chain", () => {
  // X-Forwarded-For grows left to right: the caller writes the prefix, the
  // edge appends what it actually saw. Keying on entry [0] therefore keyed on
  // a value the caller chose, so varying one header partitioned the limiter
  // into unlimited buckets — the only spend control on an endpoint that costs
  // money per call.
  it("keys on the entry the edge appended, not the one the caller sent", () => {
    const a = clientKey(
      new Headers({ "x-forwarded-for": "198.51.100.1, 203.0.113.7" }),
      "agent",
    );
    const b = clientKey(
      new Headers({ "x-forwarded-for": "10.9.9.9, 203.0.113.7" }),
      "agent",
    );
    const c = clientKey(
      new Headers({ "x-forwarded-for": "203.0.113.7" }),
      "agent",
    );
    // All three are the same real client, so all three must share a bucket.
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe("agent:203.0.113.7");
  });

  it("still separates genuinely different clients", () => {
    expect(
      clientKey(new Headers({ "x-forwarded-for": "1.1.1.1" }), "agent"),
    ).not.toBe(
      clientKey(new Headers({ "x-forwarded-for": "2.2.2.2" }), "agent"),
    );
  });
});

describe("globalLimit", () => {
  // A ceiling no header can partition. Per-client limiting is defeated by
  // anything that controls its own identity, so an endpoint that spends money
  // needs a bound on the total as well.
  it("caps the total regardless of who is calling", () => {
    const scope = `test-global-${Math.round(performance.now())}`;
    for (let i = 0; i < 3; i += 1) {
      expect(globalLimit(scope, { limit: 3, windowMs: 60_000 }).allowed).toBe(
        true,
      );
    }
    const over = globalLimit(scope, { limit: 3, windowMs: 60_000 });
    expect(over.allowed).toBe(false);
    expect(over.retryAfterSeconds).toBeGreaterThan(0);
  });
});
