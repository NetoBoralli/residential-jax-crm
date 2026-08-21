# Residential Property Acquisition CRM (Jacksonville / Duval County Focus)

## Context

Residential acquisition teams (investors, wholesalers, and buy-and-hold operators) need a practical CRM for identifying and acting on distressed or target-fit properties in Jacksonville and greater Duval County, Florida. The immediate requirement is a map-based CRM that consumes the continuous / incremental Duval County Oracle pipeline (property, permit, ownership, location, and related public-source data) so teams can quickly search for properties that match their criteria and be proactively notified when new or updated records match those criteria.

Data ingestion for core county property records is covered by the Duval pipeline user story; this CRM consumes that output. Optional court-data ingestion (foreclosure, lien, probate, code enforcement, etc.) may be included to strengthen distressed-property signals.

## Description

Create a map-based Residential Property Acquisition CRM centered on Jacksonville / Duval County, FL. Users define target criteria (for example: long ownership tenure, aging roofs, tax or ownership distress signals, geographic preferences, or optional court signals such as foreclosure filings and liens), search the live Duval dataset, save those criteria, and receive proactive notifications when the continuous pipeline surfaces new or changed properties that match.

The CRM supports the full acquisition workflow: discovery → qualification → owner outreach (mocked email / SMS / direct mail) → negotiation tracking → under-contract / closed status. It integrates the continuous Duval Oracle pipeline so that newly ingested or updated records automatically become candidates for matching and alerting. Optional enrichment with court data (foreclosure, lien, etc.) further improves identification of distressed residential properties.

## Acceptance Criteria

### Core Data & Geography

- Center the experience on Jacksonville / Duval County, Florida, consuming property, permit, ownership, location/coordinate, and related records produced by the continuous Duval County Oracle pipeline.
- Support map display of Duval parcels / properties with key attributes (parcel ID / RE#, address, owner, assessed value, ownership history signals, roof-age indicators where available, coordinates).
- Preserve source provenance for all displayed records.

### Search & Criteria Matching

- Allow users to define and save target acquisition criteria (examples: ownership duration > N years, roof age > 15 years, specific geographic bounds or neighborhoods, assessed-value bands, water-view or transit proximity signals where available from the pipeline, and optional distressed signals).
- Support quick interactive search: map radius or polygon, attribute filters, and natural-language queries via a RAG / agent interface (e.g., “show distressed residential properties in Arlington with roofs older than 15 years that have not sold in 10+ years”).
- Surface matching properties in both map and list views with clear ranking or match-score rationale.

### Proactive Notifications

- Enable saved searches / criteria sets that run against the continuous Duval pipeline on an ongoing basis.
- Proactively notify the user (in-app alerts and/or mocked email / push) when new or updated properties match a saved criteria set.
- Show notification history and the specific pipeline run / record change that triggered each alert.

### CRM Acquisition Workflow

- Create and manage CRM records for properties, owners, and acquisition opportunities.
- Track acquisition stages (e.g., Identified → Contacted → Negotiating → Under Contract → Closed / Dead).
- Support mocked outreach channels (email, SMS, direct mail) with simulated lifecycle tracking (sent, delivered, replied, bounced, etc.).
- Record owner interest, asking price / offer, notes, and next steps; assign tasks to team members.
- Filter opportunities by criteria match strength, stage, geography, ownership signals, and (if implemented) court-data distress indicators.

### Optional Court-Data Enrichment

- Optionally ingest or consume court-related public records (foreclosure filings, liens, probate, code-enforcement actions, etc.) relevant to Duval County residential properties.
- Use court signals to enrich distress scoring and to surface additional candidate properties that may not yet appear in pure assessor / permit data.
- Clearly attribute court-derived signals and preserve provenance.

### UX, Agent & Extensibility

- Provide a clean map + list + detail UI for rapid review of candidates.
- Support a RAG-backed agent for natural-language exploration of the Duval dataset and saved criteria results.
- Export selected properties, owners, and opportunity records for downstream analysis or mailing.
- Show (disabled / placeholder) sections for future expansion beyond the initial acquisition workflow (e.g., disposition, portfolio tracking, live messaging integrations).

### Demo & Integration Requirements

- Demonstrate that the CRM is driven by real (or realistically mocked) continuous Duval pipeline data rather than a static one-time snapshot.
- Demonstrate at least one end-to-end flow: define criteria → search → save criteria → simulate pipeline update → receive proactive notification → convert match into CRM opportunity → mock outreach → advance stage.
- Confirm the candidate can operate the CRM without requiring Oracle to carry ongoing hosted-database cost beyond the existing Duval pipeline + DuckDB / Elephant IPFS pattern.

## Demo Transcript

- Presenter: “I will demonstrate a Residential Property Acquisition CRM for Jacksonville / Duval County that consumes the continuous Duval Oracle pipeline, lets an acquisitions team define target criteria for distressed residential properties, search quickly, and receive proactive notifications when new matches appear.”
- Presenter: “First I open the map centered on Jacksonville / Duval County and show properties loaded from the continuous pipeline.”
  - Expected Result: Interactive map and list of Duval residential properties with key attributes and provenance.
- Presenter: “I define target criteria—for example, roofs older than 15 years, no ownership change in 10+ years, and (optionally) presence of a recent lien or foreclosure filing—and run a search.”
  - Expected Result: Matching properties appear on the map and in a ranked list with clear match rationale.
- Presenter: “I save these criteria as a named search and enable proactive notifications.”
  - Expected Result: Criteria set is saved; notification preference is confirmed.
- Presenter: “I simulate (or show a real) incremental pipeline update that brings in a new or changed property matching the criteria.”
  - Expected Result: In-app (and/or mocked external) notification is generated, linking to the specific property and the pipeline run that triggered it.
- Presenter: “I open the notified property, review owner and distress signals, and convert it into a CRM acquisition opportunity.”
  - Expected Result: Opportunity record is created with stage = Identified; owner contact details are attached.
- Presenter: “I launch a mocked outreach campaign (email / SMS / direct mail) and advance the opportunity through contact and negotiation stages.”
  - Expected Result: Simulated message lifecycle is visible; stage history and notes are recorded; tasks can be assigned.
- Presenter: “I ask the agent a natural-language question such as ‘Which residential properties in the Arlington area match my distressed criteria and have not been contacted yet?’”
  - Expected Result: Agent returns relevant matches with source-backed evidence drawn from the Duval pipeline (and optional court data).
- Presenter: “Finally I show filtering by stage, criteria match strength, and geography, plus an export of the current opportunity set.”
  - Expected Result: Filters and export work; placeholder sections for future CRM expansion are visible but disabled.

## Out of Scope (for this story)

- Full implementation of the continuous Duval County data-ingestion pipeline itself (covered by the separate Duval pipeline user story). This CRM consumes its output.
- Live production messaging to property owners (outreach remains mocked).
- Full legal / title closing workflow or escrow integration.
- Multi-county expansion beyond Duval / Jacksonville for the initial milestone (architecture should remain extensible).

## Reference

- [Duval County Oracle Pipeline](https://github.com/prismteam-ai/oracle-property-intelligence-platform-pipeline-duval-fl) — continuous / incremental source of property, permit, ownership, and location data; publishes to Elephant IPFS.
- [Soofi XYZ Team Kit](https://github.com/soofi-xyz/soofi-xyz-team-kit)
- [Elephant Oracle Skills](https://github.com/elephant-xyz/skills)

---

# Implementation

_Everything above is the assignment. Everything below is what was built for it._

## Live

|                                                                     |                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------- |
| **CRM**                                                             | https://crm-web-production-32c5.up.railway.app      |
| **Data source** (the Duval Oracle pipeline, a separate submission)  | https://oracle-web-production-1976.up.railway.app   |
| **Guided demo** — the required end-to-end flow as twelve deep links | https://crm-web-production-32c5.up.railway.app/demo |

Both are public. There is no login, no credential, and nothing to install.

## The one idea

This CRM stores **no Duval County property data**. Not one column. It keeps
workspace state — saved criteria, alerts, opportunities, outreach, notes, tasks
— and references properties by folio. Every property fact on every page is read
live from the Oracle pipeline's MCP surface.

That is not architectural tidiness; it is the thing that keeps the two systems
from disagreeing. Roof age is derived from effective year built. Tenure falls
back to the Florida assessment-cap differential for the ~87% of parcels with no
recorded sale. "Waterfront" means proximity to a named water body, not a view.
A CRM that read the published Parquet directly would have to re-implement all of
that, and the first time either side moved a threshold the two would quietly
start disagreeing about which properties are waterfront — with no error and no
way to tell which was right.

See [`docs/access-boundaries.md`](docs/access-boundaries.md) for how the
boundary is enforced (one transport module, a runtime `fetch` guard, and a test
that asserts the guard fires) and for its honest limits.

## Running it

```bash
pnpm install
pnpm --filter @jax-crm/web dev      # http://localhost:3000
```

| Variable            | Required          | Default             | What it does                                                                                                        |
| ------------------- | ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ORACLE_MCP_URL`    | no                | the deployed Oracle | Where Duval data is read from. Point it at a local Oracle to develop against one.                                   |
| `CRM_DATA_DIR`      | no                | `/data`             | Where the CRM's own DuckDB file lives. On Railway this is the mounted volume; locally, set it to anything writable. |
| `ANTHROPIC_API_KEY` | for `/agent` only | —                   | The natural-language agent. Every other page works without it.                                                      |

```bash
pnpm test            # unit + integration; the live suite skips itself
pnpm type-check
pnpm format:check

# The end-to-end suite talks to a real Oracle, so it is opt-in and refuses to
# run against a store that already has data:
ORACLE_MCP_URL=https://oracle-web-production-1976.up.railway.app/mcp \
CRM_DATA_DIR=/tmp/crm-e2e pnpm --filter @jax-crm/web test
```

## Deployment

A container built by GitHub Actions to GHCR, pulled by Railway, with a volume
mounted at `/data`. [`railway.json`](railway.json) pins the deploy config —
including `numReplicas: 1`, which
[ADR 001](docs/architecture-decisions/001-no-hosted-database.md) depends on:
the store is a single-writer file, and a second replica would diverge.

## Design notes

- **[ADR 001 — the CRM runs on a file, not a hosted database](docs/architecture-decisions/001-no-hosted-database.md).** What that buys, and what it costs, stated rather than hidden.
- **[Access boundaries](docs/access-boundaries.md).** How Duval data is consumed, and why reaching around it would be worse than slower.

## What is deliberately not built

Court-data distress signals, disposition and portfolio tracking, and live
messaging integrations. Each is marked on the dashboard with the reason it was
cut rather than stubbed. Outreach is simulated end to end and labelled as such
everywhere it renders; the per-channel lifecycles still differ, because a posted
letter genuinely has no delivery receipt and cannot be "opened".
