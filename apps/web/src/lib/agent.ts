import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { all } from "./db";
import {
  getPropertyQuerySchema,
  listPipelineRuns,
  listStandardQuestions,
  queryProperties,
} from "./oracle-client";

/**
 * The natural-language interface over the CRM and its data source.
 *
 * Sonnet rather than Opus: this is an interactive surface where a user is
 * waiting, the tools do the retrieval, and the model's job is to choose them
 * and read the results honestly. Latency matters more than the last increment
 * of reasoning depth.
 *
 * Every tool here is either a CRM query or a call to the Duval Oracle. The
 * agent has no third path to property data, for the same reason the UI has
 * none.
 */
const MODEL = "claude-sonnet-5";

export interface AgentStep {
  tool: string;
  summary: string;
  detail?: string;
}

export interface AgentAnswer {
  text: string;
  steps: AgentStep[];
  durationMs: number;
  model: string;
  /** Set when the agent stopped without writing an answer. */
  incomplete?: string;
}

const SYSTEM = `You are the acquisitions analyst inside a residential property CRM for Jacksonville / Duval County, Florida.

You answer with facts you retrieved, never with facts you assumed. Every number you state must come from a tool result in this conversation. If a tool returns nothing, say so plainly rather than estimating.

The property data comes from the Duval Oracle pipeline, which publishes a 404,023-row query table derived from the Florida Department of Revenue tax roll, parcel geometry, and Overture Places. Several of its columns are derived proxies rather than observations, and you must carry the caveat whenever you use one:
- roof_age_years is derived from effective year built. It is an upper bound: a roof replaced without the improvement reaching the roll still reads as old. There is no roofing-permit data.
- tenure: only ~51,000 of 404,023 parcels carry a recorded sale. For the rest, tenure_class is inferred from the Florida assessment-cap differential, which is an indicator, not a date.
- water_view_class means proximity to a named water body, not a view. Orientation and obstruction are unknown.
- owner_region_class is derived from the owner's tax-mailing address, which is not necessarily where they live.
- has_permits, permit_count, has_sunbiz_tenant and has_bbb_contractor are NULL for every parcel: those sources are not ingested. Never report them as false.

Useful columns: request_identifier, address_street, address_city, address_zip, owner_name, owner_mailing_city, owner_mailing_state, owner_region_class, owner_portfolio_size, market_value, assessed_value, land_value, built_year, roof_age_years, roof_age_basis, years_since_last_sale, tenure_class, last_sale_date, last_sale_price, water_view_class, dist_to_water_m, nearest_water_name, dist_to_transit_m, dist_to_starbucks_m, property_usage_type, latitude, longitude.

Two traps that produce silently empty results:
- Tenure. years_since_last_sale is NULL for ~87% of parcels, so "years_since_last_sale > 10" quietly excludes almost everything. Use tenure_class IN ('held_10_plus_years','likely_held_10_plus_years'), or OR the two together.
- Neighbourhoods. address_city is the incorporated city, which is 'JACKSONVILLE' for 94% of the county. Jacksonville neighbourhoods — Arlington, Riverside, Mandarin, Springfield, San Marco, Murray Hill — do not appear in it. Match them by address_zip instead: Arlington is roughly 32211, 32225, 32277; Riverside/Avondale 32204, 32205; Mandarin 32223, 32257; Springfield 32206; San Marco 32207. Say which ZIPs you used.

Filter to property_usage_type = 'residential' unless asked otherwise, and require address_street IS NOT NULL for anything a user might act on.

If a query returns zero rows, do not stop there and do not report zero as the answer — check whether a predicate excluded NULLs, loosen it, and try once more. Only report an empty result after you have confirmed it is genuinely empty.

Be concise. Lead with the answer. Then the basis, then the caveat. When you list properties, give the folio so the user can open them.`;

export async function askAgent(question: string): Promise<AgentAnswer> {
  const started = Date.now();
  const steps: AgentStep[] = [];

  const result = await generateText({
    model: anthropic(MODEL),
    system: SYSTEM,
    prompt: question,
    stopWhen: stepCountIs(12),
    tools: {
      describeDataset: tool({
        description:
          "List the columns of the Duval property query table. Call this before writing SQL you are unsure about.",
        inputSchema: z.object({}),
        execute: async () => {
          const schema = await getPropertyQuerySchema();
          steps.push({
            tool: "describeDataset",
            summary: `${schema.columns.length} columns`,
          });
          return schema;
        },
      }),

      standardQuestions: tool({
        description:
          "List the six standard property-intelligence questions the pipeline answers, with the basis and caveat for each.",
        inputSchema: z.object({}),
        execute: async () => {
          const qs = await listStandardQuestions();
          steps.push({
            tool: "standardQuestions",
            summary: `${qs.questions.length} standard questions`,
          });
          return qs;
        },
      }),

      queryDuval: tool({
        description:
          "Run one read-only SELECT against the Duval `properties` view. Use count(*) for totals; return request_identifier when listing properties.",
        inputSchema: z.object({
          sql: z
            .string()
            .describe("A single read-only SELECT over `properties`."),
          limit: z
            .number()
            .optional()
            .describe("Row cap, default 25, max 200."),
        }),
        execute: async ({ sql, limit }) => {
          const res = await queryProperties(sql, Math.min(limit ?? 25, 200));
          steps.push({
            tool: "queryDuval",
            summary: `${res.rowCount ?? res.rows.length} rows · ${res.durationMs} ms`,
            detail: res.sql,
          });
          return { rows: res.rows, rowCount: res.rowCount ?? res.rows.length };
        },
      }),

      pipelineRuns: tool({
        description:
          "List recent pipeline runs with their insert/update/delete counts. Use for questions about what changed and when.",
        inputSchema: z.object({ limit: z.number().optional() }),
        execute: async ({ limit }) => {
          const res = await listPipelineRuns(Math.min(limit ?? 10, 25));
          steps.push({
            tool: "pipelineRuns",
            summary: `${res.runs.length} runs`,
          });
          return res;
        },
      }),

      crmPipeline: tool({
        description:
          "Query this CRM's own state: saved criteria, alerts, opportunities, stages, outreach. Use for 'our', 'my', 'in the pipeline' questions.",
        inputSchema: z.object({
          what: z
            .enum(["searches", "alerts", "opportunities", "outreach"])
            .describe("Which part of the CRM to summarise."),
        }),
        execute: async ({ what }) => {
          const sql = {
            searches:
              "SELECT search_id, name, notify, last_checked_run_id FROM saved_searches ORDER BY created_at DESC LIMIT 25",
            alerts:
              "SELECT notification_id, search_id, run_id, matched_count, changed_in_run, created_at FROM notifications ORDER BY created_at DESC LIMIT 25",
            opportunities:
              "SELECT opportunity_id, folio, address, owner_name, stage, match_score, offer_price, assigned_to FROM opportunities ORDER BY updated_at DESC LIMIT 50",
            outreach:
              "SELECT outreach_id, opportunity_id, channel, status, created_at FROM outreach ORDER BY created_at DESC LIMIT 50",
          }[what];
          const rows = await all(sql);
          steps.push({
            tool: "crmPipeline",
            summary: `${what}: ${rows.length} rows`,
          });
          return { rows };
        },
      }),
    },
  });

  // A blank answer panel is worse than an error: it reads as "this feature is
  // broken" with nothing to act on. If the agent spent its step budget without
  // writing a conclusion, say exactly that and leave the tool trace visible so
  // the work it did do is still useful.
  const text = result.text.trim();
  const incomplete = text
    ? undefined
    : `The agent used all ${steps.length} of its tool calls without reaching a conclusion (finish reason: ${result.finishReason}). The queries it ran are below — they are real results, just not yet summarised. Asking a narrower question usually gets there.`;

  return {
    text,
    steps,
    durationMs: Date.now() - started,
    model: MODEL,
    ...(incomplete ? { incomplete } : {}),
  };
}
