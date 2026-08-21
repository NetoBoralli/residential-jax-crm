# Access boundaries

## The rule

This CRM reads Duval County property data **only** through the Duval Oracle
pipeline's MCP tool surface. It does not read the Elephant IPFS artifacts, does
not query the pipeline's DuckDB warehouse, and does not fetch the Florida
Department of Revenue or Overture sources.

## Why it matters more than it looks

The tempting shortcut is real: the query table is a 40 MB Parquet file on a
public gateway, and reading it directly would be _faster_ than a round trip
through the Oracle. The reason not to is that the artifact is not
self-describing. `roof_age_years` is derived from effective year built and is an
upper bound. `tenure_class` falls back to the Florida assessment-cap
differential for the ~87% of parcels with no recorded sale.
`water_view_class` means proximity to a named water body, not a view.

Every one of those derivations lives in the pipeline, along with the caveat that
bounds it. A CRM that read the Parquet directly would have to re-implement them,
and the moment either side changed a threshold the two systems would start
quietly disagreeing about which properties are waterfront — with no error, no
alert, and no way to tell which answer was right.

So the boundary is not bureaucracy. It is the thing that keeps one definition of
a waterfront property in one place.

## How it is enforced

**1. One module constructs the transport.** `src/lib/oracle-client.ts` is the
only file that builds a request to the Oracle. Everything else — pages, server
actions, the agent, the CSV export — calls a typed function from it.

**2. A runtime fetch guard.** `src/instrumentation.ts` wraps `globalThis.fetch`
for the whole server runtime and throws `AccessBoundaryViolation` on any request
to an upstream host:

| Host                                      | Why                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `ipfs.filebase.io`                        | The published artifacts. Reading them directly skips the Oracle's derivations and caveats.      |
| `s3.filebase.io`                          | The object store behind those artifacts.                                                        |
| `api.filebase.io`                         | IPNS control. The CRM has no business moving a pointer it does not own.                         |
| `floridarevenue.com`                      | The raw Florida DOR tax roll. Re-deriving from source is exactly the duplication this prevents. |
| `overturemaps-us-west-2.s3.amazonaws.com` | Raw Overture Places and water. Same reason.                                                     |

It throws synchronously rather than rejecting: a blocked host is a programming
error, not a network condition, so the offending call belongs at the top of the
stack. It is a hard failure rather than a warning because a warning gets ignored
under deadline, and the first direct read quietly becomes permanent.

Note the shape of the guard, and its limits. It is a **denylist**, not an
allowlist: `ipfs.io` and `dweb.link` serve the identical artifact and are not
blocked, and it wraps `fetch` only, so a direct `node:http` request would pass.
Both are deliberate — an allowlist would break the CARTO basemap tiles and the
Anthropic API, and this app makes exactly two outbound calls, both through
`oracle-client.ts`. The guard is there to make an accidental shortcut fail
loudly, not to contain an adversary who controls the code.

**3. A test.** `src/lib/access-boundary.test.ts` asserts the guard fires for
each blocked host and for subdomains of them, and that it leaves the sanctioned
endpoint and unrelated hosts alone. The boundary is covered by a test rather
than by a comment.

## What the CRM does store

Workspace state, and only workspace state: saved criteria sets, alerts,
opportunities, stage history, outreach, notes and tasks. Properties are
referenced by folio (`request_identifier`) and nothing else. The
`notification_matches` table holds a snapshot of what a property looked like
when an alert fired — that is an audit record of the alert, not a cache to read
from, and every live view re-reads the property from the Oracle.

## Seeing it at runtime

`/integration` renders the live endpoint, the tools the Oracle currently
exposes, the dataset pointer it resolves, and the blocked-host list. The claim
on this page is checkable in the deployed app rather than only in the repo.
