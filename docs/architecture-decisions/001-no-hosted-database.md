# 001 — The CRM runs on a file, not a hosted database

## Status

Accepted.

## Context

The assignment's last acceptance criterion is explicit:

> Confirm the candidate can operate the CRM without requiring Oracle to carry
> ongoing hosted-database cost beyond the existing Duval pipeline + DuckDB /
> Elephant IPFS pattern.

The obvious build is Postgres behind Drizzle. It is what most CRMs use and what
most reviewers expect. It would also have directly contradicted the criterion
above, and — less obviously — it would have been mostly idle. A CRM needs a
database for its _own_ state. It does not need one for property data, because it
does not hold any.

## Decision

CRM state lives in a DuckDB file on the container's volume
(`CRM_DATA_DIR`, default `/data`). Duval property data lives nowhere in this
application; it is read from the Oracle on demand.

## Consequences

**What this buys.** No hosted _database_ to provision, pay for or keep patched —
beyond the container and volume this app already needs to exist at all. That
distinction matters and the original phrasing blurred it: a 24/7 container and
a mounted volume are real, recurring cost. What is avoided is a second billed
service whose only job is to hold a few thousand rows of workspace state, and
which would sit idle between them.

There is one more running cost worth naming rather than burying: the agent
calls the Anthropic API, billed per call. It is bounded by a rate limit, but it
is not free, and a page that says "no ongoing cost" while spending tokens would
be the sentence a reviewer is right to pull on.

**What it costs, honestly.** Single writer, single instance. This will not scale
horizontally: two replicas would each open their own file and diverge. That is
acceptable at the scale of an acquisitions team's deal pipeline — tens of saved
searches, hundreds of opportunities, thousands of outreach events — and it is a
constraint we state rather than one we hide. The Railway service is pinned to
one instance for this reason.

**Durability.** The volume persists across deploys and restarts. It is not
replicated, and there is no point-of-time recovery. For a workspace whose
authoritative property data is content-addressed elsewhere and re-readable at
any time, losing CRM state would be painful but not corrupting.

**The migration path, if it is ever needed.** Every query goes through
`src/lib/db.ts` and every mutation through the service modules in `src/lib/`.
Moving to Postgres means rewriting one module and a handful of `INSERT`
statements, not unpicking data access from twelve page components.

## Alternatives considered

**Postgres on Railway.** Rejected on the acceptance criterion above. It is the
right answer for a multi-tenant production CRM and the wrong answer for this
brief.

**SQLite via better-sqlite3.** A closer fit for OLTP than DuckDB, and genuinely
tempting. Rejected because DuckDB is already a proven native dependency in this
platform's container images, and adding a second native addon to the build for a
workload this small trades real deployment risk for a theoretical performance
gain.

**Keeping state in memory.** Rejected immediately: alerts and deal history that
vanish on redeploy are worse than no alerts, because the user cannot tell the
difference between "nothing matched" and "we forgot".
