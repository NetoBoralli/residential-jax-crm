import { csvCell } from "./csv";
import { all } from "@/lib/db";
import { queryProperties } from "@/lib/oracle-client";
import { sqlString } from "@/lib/sql";
import { isStage, listOpportunities } from "@/lib/opportunities";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * CSV export for downstream analysis or a mailing house.
 *
 * Property facts are re-read from the Oracle at export time rather than served
 * from what the CRM happened to capture when a deal was opened. An export that
 * quietly ships a six-week-old owner name is worse than no export: it becomes a
 * mailing list addressed to people who have sold.
 */

function csv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  return [
    columns.join(","),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")),
  ].join("\n");
}

function download(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}

const EXPORT_TYPES = ["opportunities", "owners", "notifications"] as const;

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "opportunities";
  const stage = url.searchParams.get("stage") ?? undefined;

  // An unknown type used to fall through to the opportunities export, so a
  // typo produced a plausible-looking file of the wrong thing.
  if (!(EXPORT_TYPES as readonly string[]).includes(type)) {
    return Response.json(
      {
        error: `Unknown export type "${type}".`,
        available: EXPORT_TYPES,
      },
      { status: 400 },
    );
  }

  if (type === "notifications") {
    const rows = await all(`
      SELECT n.notification_id, n.search_id, s.name AS search_name, n.run_id,
             n.changes_cid, n.changed_in_run, n.matched_count, n.created_at,
             m.folio, m.delta_type, m.address, m.owner_name, m.market_value
        FROM notifications n
        LEFT JOIN saved_searches s USING (search_id)
        LEFT JOIN notification_matches m USING (notification_id)
       ORDER BY n.created_at DESC, m.market_value DESC
    `);
    return download(
      csv(rows, [
        "notification_id",
        "search_name",
        "run_id",
        "changes_cid",
        "changed_in_run",
        "matched_count",
        "folio",
        "delta_type",
        "address",
        "owner_name",
        "market_value",
        "created_at",
      ]),
      "jax-crm-alerts.csv",
    );
  }

  const opportunities = await listOpportunities(
    stage && isStage(stage) ? { stage } : undefined,
  );
  if (opportunities.length === 0) {
    return download("", `jax-crm-${type}.csv`);
  }

  // Property facts are fetched in pages. The Oracle caps a single response at
  // 1000 rows, and asking for more than that used to return the first 1000 and
  // silently emit blank owner names and blank mailing addresses for the rest —
  // a mailing list with unaddressed entries and nothing anywhere to say so.
  const PAGE = 500;
  const byFolio = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < opportunities.length; i += PAGE) {
    const page = opportunities.slice(i, i + PAGE);
    const folios = page.map((o) => sqlString(o.folio)).join(", ");
    const live = await queryProperties(
      `SELECT request_identifier, address_street, address_city, address_zip,
              owner_name, owner_mailing_city, owner_mailing_state,
              market_value, assessed_value, roof_age_years, tenure_class,
              years_since_last_sale, owner_region_class, owner_portfolio_size,
              latitude, longitude
         FROM properties WHERE request_identifier IN (${folios})`,
      PAGE,
    );
    for (const row of live.rows) {
      byFolio.set(row.request_identifier, row as Record<string, unknown>);
    }
  }

  const joined = opportunities.map((o) => {
    const p = byFolio.get(o.folio) ?? {};
    return {
      ...o,
      ...Object.fromEntries(
        Object.entries(p).map(([k, v]) => [`property_${k}`, v]),
      ),
      match_rationale: o.match_rationale ?? "",
    };
  });

  if (type === "owners") {
    return download(
      csv(joined, [
        "folio",
        "property_owner_name",
        "property_address_street",
        "property_address_city",
        "property_address_zip",
        "property_owner_mailing_city",
        "property_owner_mailing_state",
        "property_owner_region_class",
        "property_owner_portfolio_size",
        "stage",
        "match_score",
      ]),
      "jax-crm-owners.csv",
    );
  }

  return download(
    csv(joined, [
      "opportunity_id",
      "folio",
      "address",
      "owner_name",
      "stage",
      "match_score",
      "match_rationale",
      "source_search_id",
      "source_run_id",
      "owner_interest",
      "asking_price",
      "offer_price",
      "assigned_to",
      "next_step",
      "property_market_value",
      "property_assessed_value",
      "property_roof_age_years",
      "property_tenure_class",
      "property_years_since_last_sale",
      "property_latitude",
      "property_longitude",
      "created_at",
      "updated_at",
    ]),
    "jax-crm-opportunities.csv",
  );
}
