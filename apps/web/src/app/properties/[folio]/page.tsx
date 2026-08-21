import Link from "next/link";

import { convertAction } from "@/app/actions";
import { ParcelMap } from "@/components/parcel-map";
import {
  MatchScore,
  OracleDown,
  Provenance,
  cell,
  money,
} from "@/components/ui";
import { columnsFor, criteriaFromParams, score } from "@/lib/criteria";
import { sqlString } from "@/lib/sql";
import { OracleUnavailable, queryProperties } from "@/lib/oracle-client";
import { getOpportunityByFolio } from "@/lib/opportunities";

export const dynamic = "force-dynamic";

/** Fields worth showing on a detail page, grouped the way an analyst reads them. */
const SECTIONS: Array<{ title: string; fields: Array<[string, string]> }> = [
  {
    title: "Property",
    fields: [
      ["address_street", "Address"],
      ["address_city", "City"],
      ["address_zip", "ZIP"],
      ["property_type", "Type"],
      ["property_usage_type", "Use"],
      ["built_year", "Year built"],
      ["livable_floor_area", "Living area (sq ft)"],
      ["lot_area_sqft", "Lot (sq ft)"],
      ["subdivision", "Subdivision"],
    ],
  },
  {
    title: "Valuation",
    fields: [
      ["market_value", "Just value"],
      ["assessed_value", "Assessed value"],
      ["land_value", "Land value"],
      ["assessment_differential_ratio", "Assessment gap"],
    ],
  },
  {
    title: "Ownership",
    fields: [
      ["owner_name", "Owner"],
      ["owner_occupied", "Owner-occupied"],
      ["owner_mailing_city", "Mailing city"],
      ["owner_mailing_state", "Mailing state"],
      ["owner_region_class", "Owner locality"],
      ["owner_portfolio_size", "Duval parcels held"],
      ["last_sale_date", "Last recorded sale"],
      ["last_sale_price", "Last sale price"],
      ["years_since_last_sale", "Years since sale"],
      ["tenure_class", "Tenure"],
      ["tenure_basis", "Tenure basis"],
    ],
  },
  {
    title: "Acquisition signals",
    fields: [
      ["roof_age_years", "Roof age (yrs)"],
      ["roof_age_basis", "Roof age basis"],
      ["roof_age_confidence", "Confidence"],
      ["water_view_class", "Water"],
      ["dist_to_water_m", "Distance to water (m)"],
      ["nearest_water_name", "Water body"],
      ["dist_to_transit_m", "Distance to transit (m)"],
      ["dist_to_starbucks_m", "Distance to Starbucks (m)"],
    ],
  },
  {
    title: "Coverage gaps",
    fields: [
      ["has_permits", "Permit history"],
      ["permit_count", "Permits"],
      ["has_sunbiz_tenant", "Sunbiz tenant"],
      ["has_bbb_contractor", "BBB contractor"],
      ["hoa_flag", "HOA"],
    ],
  },
];

export default async function PropertyPage({
  params,
  searchParams,
}: {
  params: Promise<{ folio: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { folio } = await params;
  const sp = await searchParams;
  const criteria = criteriaFromParams(sp);
  const decoded = decodeURIComponent(folio);

  let row: Record<string, unknown> | undefined;
  let sql = "";
  let durationMs = 0;
  let provenance: Record<string, unknown> = {};
  let error: string | undefined;

  try {
    const wanted = new Set([
      ...columnsFor(criteria),
      ...SECTIONS.flatMap((s) => s.fields.map(([k]) => k)),
      "request_identifier",
      "parcel_identifier",
      "county_name",
      "state_code",
      "source_system",
      "latitude",
      "longitude",
    ]);
    const res = await queryProperties(
      `SELECT ${[...wanted].join(", ")} FROM properties WHERE request_identifier = ${sqlString(decoded)}`,
      1,
    );
    row = res.rows[0] as Record<string, unknown> | undefined;
    sql = res.sql;
    durationMs = res.durationMs;
    provenance = res.provenance;
  } catch (e) {
    error =
      e instanceof OracleUnavailable || e instanceof Error
        ? e.message
        : String(e);
  }

  if (error) return <OracleDown error={error} />;

  if (!row) {
    return (
      <>
        <h1>{decoded}</h1>
        <div className="card" data-testid="not-found">
          <p className="muted">
            No parcel with folio <span className="mono">{decoded}</span> is in
            the published Duval dataset. Folios carry significant leading zeros
            — check the value is complete.
          </p>
        </div>
      </>
    );
  }

  const matched = score(criteria, row);
  const existing = await getOpportunityByFolio(decoded);
  const lat = Number(row["latitude"]);
  const lon = Number(row["longitude"]);

  return (
    <>
      <h1 data-testid="property-address">
        {String(row["address_street"] ?? decoded)}
      </h1>
      <p className="lede">
        {String(row["address_city"] ?? "Duval County")} ·{" "}
        <span className="mono">{decoded}</span> · owned by{" "}
        {String(row["owner_name"] ?? "an unnamed party")}
      </p>

      <div className="row-actions" style={{ marginTop: 16 }}>
        {matched.rationale.length ? (
          <MatchScore
            score={matched.score}
            rationale={matched.rationale}
            testId="detail-match"
          />
        ) : null}
        {existing ? (
          <Link
            className="btn"
            href={`/opportunities/${existing.opportunity_id}`}
          >
            Open opportunity {existing.opportunity_id}
          </Link>
        ) : (
          <form action={convertAction} data-testid="convert-form">
            <input type="hidden" name="folio" value={decoded} />
            <input
              type="hidden"
              name="address"
              value={String(row["address_street"] ?? "")}
            />
            <input
              type="hidden"
              name="owner_name"
              value={String(row["owner_name"] ?? "")}
            />
            {/* Only sent when criteria were actually applied. Posting 0 for a
                property opened without criteria wrote match_score = 0, which
                the pipeline then renders as "0% match" — asserting the deal was
                evaluated and scored nothing, rather than never scored. */}
            {matched.rationale.length > 0 ? (
              <>
                <input
                  type="hidden"
                  name="score"
                  value={String(matched.score)}
                />
                <input
                  type="hidden"
                  name="rationale"
                  value={matched.rationale.join(" · ")}
                />
              </>
            ) : null}
            <button className="btn" type="submit" data-testid="convert">
              Track as opportunity
            </button>
          </form>
        )}
      </div>

      {Number.isFinite(lat) && Number.isFinite(lon) ? (
        <div style={{ marginTop: 20 }}>
          <ParcelMap
            height={280}
            points={[
              {
                folio: decoded,
                lat,
                lon,
                label: String(row["address_street"] ?? decoded),
                score: matched.score,
              },
            ]}
          />
        </div>
      ) : (
        <p className="subtle" style={{ marginTop: 16 }}>
          This parcel has no centroid in the published geometry vintage, so it
          cannot be mapped. Its roll record is complete.
        </p>
      )}

      <div className="grid" style={{ marginTop: 24 }}>
        {SECTIONS.map((section) => (
          <div className="card" key={section.title}>
            <h3>{section.title}</h3>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {section.fields.map(([key, label]) => {
                  const v = row![key];
                  const isMoney =
                    key.endsWith("_value") || key.endsWith("_price");
                  return (
                    <tr key={key}>
                      <td className="muted">{label}</td>
                      <td data-testid={`field-${key}`}>
                        {v === null || v === undefined
                          ? "—"
                          : isMoney
                            ? money(v)
                            : cell(v, typeof v === "number")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {section.title === "Coverage gaps" ? (
              <p className="subtle" style={{ marginTop: 10 }}>
                These publish as NULL, not as false. The Duval pipeline does not
                ingest permit, Sunbiz or BBB data for this milestone, and
                defaulting them to &ldquo;no permits&rdquo; would read as a fact
                about the property rather than a gap in coverage.
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <Provenance sql={sql} durationMs={durationMs} detail={provenance} />
    </>
  );
}
