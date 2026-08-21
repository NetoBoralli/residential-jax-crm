/**
 * The acquisition criteria model.
 *
 * A criteria set is a small typed object, not free-form SQL. It compiles to a
 * boolean expression over the Oracle's `properties` view (which the Oracle then
 * validates against its own parse tree before running), and it scores each
 * returned property with a rationale a human can argue with.
 *
 * Scoring is deliberately explainable rather than clever. Every facet the user
 * asked for carries a weight; a property's score is the share of that weight it
 * satisfies, and the rationale names each facet with the actual value that
 * satisfied it. There is no learned model here and no hidden ranking — an
 * acquisitions team has to justify why it knocked on a door.
 */

export interface Criteria {
  /** Minimum years held. Uses the Oracle's tenure classification. */
  tenureYearsMin?: number;
  /** Minimum derived roof age in years. */
  roofAgeMin?: number;
  /** "waterfront" (≤60 m) or "proximate" (≤150 m). */
  water?: "waterfront" | "proximate";
  /** Metres to the nearest transit stop. */
  transitMaxM?: number;
  /** Metres to the nearest Starbucks — a rough proxy for retail desirability. */
  starbucksMaxM?: number;
  valueMin?: number;
  valueMax?: number;
  /** Situs cities, upper-cased as the roll stores them. */
  cities?: string[];
  /** Owner locality classification from the Oracle. */
  ownerRegion?: string;
  /** Minimum number of Duval parcels the owner holds. */
  portfolioMin?: number;
  /** Restrict to residential use codes. Defaults to true. */
  residentialOnly?: boolean;
}

export interface Facet {
  key: keyof Criteria;
  label: string;
  weight: number;
  /** SQL fragment over the properties view. */
  sql: string;
  /** Columns needed to explain whether a row satisfied this facet. */
  columns: string[];
  /** Did this row satisfy it, and how would you say so in one clause? */
  explain: (row: Record<string, unknown>) => string | undefined;
  /**
   * How *strongly* this row satisfies the facet, 0–1.
   *
   * Every row returned by a search already passes the hard filter, so a score
   * built only from pass/fail is 100% on every row and ranks nothing — which
   * is exactly what it did. Facets with a magnitude grade it: a roof of 51
   * years is a stronger signal than one of 16 when you asked for over 15, and a
   * parcel 40 m from the water is stronger than one at 59 m. Facets that are
   * genuinely binary — the city matches, or it does not — return 1 and simply
   * do not discriminate, which is honest rather than padded.
   */
  strength?: (row: Record<string, unknown>) => number;
}

/** Map a value onto 0–1 by where it sits between the threshold and a ceiling. */
function ramp(value: number | undefined, from: number, to: number): number {
  if (value === undefined) return 0;
  if (to === from) return 1;
  const t = (value - from) / (to - from);
  return Math.max(0, Math.min(1, t));
}

const n = (v: unknown): number | undefined => {
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Turn a criteria set into the facets it implies.
 *
 * Weights encode what an acquisition team actually acts on: ownership tenure
 * and owner locality are the strongest signals that a door is worth knocking
 * on, physical condition proxies come next, and amenity proximity is a
 * tiebreaker rather than a reason.
 */
export function facetsFor(c: Criteria): Facet[] {
  const out: Facet[] = [];

  if (c.tenureYearsMin !== undefined) {
    const years = Math.max(0, Math.round(c.tenureYearsMin));
    out.push({
      key: "tenureYearsMin",
      label: `Held ${years}+ years`,
      weight: 3,
      // The Oracle exposes both a recorded-sale age and a banded proxy for the
      // ~87% of parcels with no sale in the current roll; accept either.
      sql: `(years_since_last_sale >= ${years} OR tenure_class IN ('held_10_plus_years','likely_held_10_plus_years'))`,
      columns: [
        "years_since_last_sale",
        "tenure_class",
        "tenure_basis",
        "assessment_differential_ratio",
      ],
      explain: (r) => {
        const y = n(r["years_since_last_sale"]);
        if (y !== undefined && y >= years) return `held ${Math.round(y)} years`;
        const cls = String(r["tenure_class"] ?? "");
        if (cls === "held_10_plus_years")
          return "held 10+ years (recorded sale)";
        if (cls === "likely_held_10_plus_years")
          return "likely held 10+ years (assessment-cap proxy)";
        return undefined;
      },
      // Longer tenure is a stronger signal, saturating 20 years past the
      // threshold. Where no sale is recorded the assessment gap stands in — it
      // widens with every year a parcel goes untransferred.
      strength: (r) => {
        const y = n(r["years_since_last_sale"]);
        if (y !== undefined) return ramp(y, years, years + 20);
        const gap = n(r["assessment_differential_ratio"]);
        return gap !== undefined ? ramp(gap, 0, 0.35) : 0.5;
      },
    });
  }

  if (c.roofAgeMin !== undefined) {
    const years = Math.max(0, Math.round(c.roofAgeMin));
    out.push({
      key: "roofAgeMin",
      label: `Roof ${years}+ years`,
      weight: 2,
      sql: `roof_age_years >= ${years}`,
      columns: ["roof_age_years", "roof_age_basis", "roof_age_confidence"],
      explain: (r) => {
        const y = n(r["roof_age_years"]);
        return y !== undefined && y >= years
          ? `roof ~${Math.round(y)} years (derived from ${String(r["roof_age_basis"] ?? "year built")})`
          : undefined;
      },
      // Saturates 25 years past the threshold — a 90-year-old roof is not
      // twice the opportunity of a 45-year-old one, and both are past due.
      strength: (r) => ramp(n(r["roof_age_years"]), years, years + 25),
    });
  }

  if (c.water) {
    const proximate = c.water === "proximate";
    out.push({
      key: "water",
      label: proximate ? "Near water" : "Waterfront",
      weight: 2,
      sql: proximate
        ? `water_view_class IN ('waterfront','water_proximate')`
        : `water_view_class = 'waterfront'`,
      columns: ["water_view_class", "dist_to_water_m", "nearest_water_name"],
      explain: (r) => {
        const cls = String(r["water_view_class"] ?? "");
        if (!cls || cls === "inland") return undefined;
        const d = n(r["dist_to_water_m"]);
        const name = r["nearest_water_name"];
        return `${Math.round(d ?? 0)} m from ${name ? String(name) : "water"}`;
      },
      strength: (r) => {
        const d = n(r["dist_to_water_m"]);
        return d === undefined ? 0 : 1 - ramp(d, 0, proximate ? 150 : 60);
      },
    });
  }

  if (c.transitMaxM !== undefined) {
    const m = Math.max(0, Math.round(c.transitMaxM));
    out.push({
      key: "transitMaxM",
      label: `Transit within ${m} m`,
      weight: 1,
      sql: `dist_to_transit_m IS NOT NULL AND dist_to_transit_m <= ${m}`,
      columns: ["dist_to_transit_m"],
      explain: (r) => {
        const d = n(r["dist_to_transit_m"]);
        return d !== undefined && d <= m
          ? `${Math.round(d)} m to transit`
          : undefined;
      },
      strength: (r) => 1 - ramp(n(r["dist_to_transit_m"]), 0, m),
    });
  }

  if (c.starbucksMaxM !== undefined) {
    const m = Math.max(0, Math.round(c.starbucksMaxM));
    out.push({
      key: "starbucksMaxM",
      label: `Starbucks within ${m} m`,
      weight: 1,
      sql: `dist_to_starbucks_m IS NOT NULL AND dist_to_starbucks_m <= ${m}`,
      columns: ["dist_to_starbucks_m"],
      explain: (r) => {
        const d = n(r["dist_to_starbucks_m"]);
        return d !== undefined && d <= m
          ? `${Math.round(d)} m to a Starbucks`
          : undefined;
      },
      strength: (r) => 1 - ramp(n(r["dist_to_starbucks_m"]), 0, m),
    });
  }

  if (c.valueMin !== undefined || c.valueMax !== undefined) {
    const parts: string[] = [];
    if (c.valueMin !== undefined) parts.push(`market_value >= ${c.valueMin}`);
    if (c.valueMax !== undefined) parts.push(`market_value <= ${c.valueMax}`);
    out.push({
      key: "valueMin",
      label:
        c.valueMin !== undefined && c.valueMax !== undefined
          ? `Just value $${c.valueMin.toLocaleString()}–$${c.valueMax.toLocaleString()}`
          : c.valueMin !== undefined
            ? `Just value over $${c.valueMin.toLocaleString()}`
            : `Just value under $${c.valueMax!.toLocaleString()}`,
      weight: 2,
      sql: `(${parts.join(" AND ")})`,
      columns: ["market_value"],
      explain: (r) => {
        const v = n(r["market_value"]);
        if (v === undefined) return undefined;
        if (c.valueMin !== undefined && v < c.valueMin) return undefined;
        if (c.valueMax !== undefined && v > c.valueMax) return undefined;
        return `just value $${Math.round(v).toLocaleString()}`;
      },
    });
  }

  if (c.cities?.length) {
    const list = c.cities.map((x) => q(x.toUpperCase())).join(", ");
    out.push({
      key: "cities",
      label: `In ${c.cities.join(", ")}`,
      weight: 1,
      sql: `address_city IN (${list})`,
      columns: ["address_city"],
      explain: (r) =>
        c.cities!.some(
          (x) =>
            x.toUpperCase() === String(r["address_city"] ?? "").toUpperCase(),
        )
          ? `in ${String(r["address_city"])}`
          : undefined,
    });
  }

  if (c.ownerRegion) {
    const region = c.ownerRegion.replace(/[^a-z_]/g, "");
    out.push({
      key: "ownerRegion",
      label: `Owner ${region.replace(/_/g, " ")}`,
      weight: 3,
      sql:
        region === "any_non_local"
          ? `owner_region_class IN ('regional_ne_florida','regional_florida','out_of_state')`
          : `owner_region_class = ${q(region)}`,
      columns: [
        "owner_region_class",
        "owner_mailing_city",
        "owner_mailing_state",
      ],
      explain: (r) => {
        const cls = String(r["owner_region_class"] ?? "");
        if (!cls) return undefined;
        if (region !== "any_non_local" && cls !== region) return undefined;
        const city = r["owner_mailing_city"];
        const state = r["owner_mailing_state"];
        return `owner mails to ${city ? String(city) : "elsewhere"}${state ? `, ${String(state)}` : ""}`;
      },
    });
  }

  if (c.portfolioMin !== undefined) {
    const k = Math.max(1, Math.round(c.portfolioMin));
    out.push({
      key: "portfolioMin",
      label: `Owner holds ${k}+ parcels`,
      weight: 2,
      sql: `owner_portfolio_size >= ${k}`,
      columns: ["owner_portfolio_size"],
      explain: (r) => {
        const p = n(r["owner_portfolio_size"]);
        return p !== undefined && p >= k
          ? `owner holds ${p} Duval parcels`
          : undefined;
      },
      // A larger portfolio means a more practised seller and a bigger prize.
      strength: (r) => ramp(n(r["owner_portfolio_size"]), k, k + 8),
    });
  }

  return out;
}

/** Columns the Oracle must return for these criteria to be explainable. */
export const BASE_COLUMNS = [
  "request_identifier",
  "address_street",
  "address_city",
  "address_zip",
  "owner_name",
  "market_value",
  "assessed_value",
  "latitude",
  "longitude",
  "property_usage_type",
];

export function columnsFor(c: Criteria): string[] {
  const cols = new Set(BASE_COLUMNS);
  for (const f of facetsFor(c)) for (const col of f.columns) cols.add(col);
  return [...cols];
}

/**
 * The hard filter.
 *
 * Everything the user asked for must be true — the score then ranks *within*
 * those matches by how strongly each one satisfies the criteria, using the
 * facets that are gradable. A soft filter that returned near-misses would make
 * the count meaningless: "412 properties match" has to mean they match.
 */
export function whereFor(c: Criteria): string {
  const parts = facetsFor(c).map((f) => f.sql);
  if (c.residentialOnly !== false)
    parts.push(`property_usage_type = 'residential'`);
  parts.push(`address_street IS NOT NULL AND address_street <> ''`);
  return parts.join("\n  AND ");
}

export interface Scored {
  /**
   * Signal strength, 0–100. NOT "percent of criteria met".
   *
   * Every property in a result set already meets every criterion — the filter
   * is a hard AND — so a percentage-of-criteria score is 100 on every row and
   * ranks nothing. This grades how far past each threshold a property sits, so
   * it is a priority order within the matched set. A low number does not mean
   * a weak match; it means a match that only just qualifies.
   */
  score: number;
  rationale: string[];
}

/**
 * Score a property against the criteria that returned it.
 *
 * A search applies its criteria as a hard filter, so every row here already
 * satisfies all of them. Scoring on pass/fail therefore gave 100% to every row
 * and ranked nothing — the list was really ordered by just value with a
 * decorative badge attached. The score now grades *how strongly* each facet is
 * satisfied, so a 51-year roof outranks a 16-year one and a parcel 12 m from
 * the river outranks one at 58 m.
 *
 * Facets with no magnitude (city, owner locality) contribute their full weight
 * without discriminating, which is the honest treatment: they are satisfied,
 * and there is no "more satisfied".
 */
export function score(c: Criteria, row: Record<string, unknown>): Scored {
  const facets = facetsFor(c);
  if (facets.length === 0) return { score: 0, rationale: [] };

  let earned = 0;
  let total = 0;
  const rationale: string[] = [];
  for (const f of facets) {
    total += f.weight;
    const why = f.explain(row);
    if (!why) continue;
    rationale.push(why);
    const strength = f.strength ? f.strength(row) : 1;
    earned += f.weight * Math.max(0, Math.min(1, strength));
  }
  return { score: Math.round((earned / total) * 100), rationale };
}

/** Human-readable summary of a criteria set, for lists and notifications. */
export function describe(c: Criteria): string {
  const labels = facetsFor(c).map((f) => f.label);
  if (labels.length === 0) return "All residential parcels";
  return labels.join(" · ");
}

/** Parse criteria out of URL search params so every view is deep-linkable. */
export function criteriaFromParams(
  params: Record<string, string | string[] | undefined>,
): Criteria {
  const num = (k: string): number | undefined => {
    const raw = params[k];
    const v = Number(Array.isArray(raw) ? raw[0] : raw);
    return Number.isFinite(v) ? v : undefined;
  };
  const raw = (k: string): string | undefined => {
    const v = params[k];
    return Array.isArray(v) ? v[0] : v;
  };
  /** "any" is the select's own "no preference" option, not a value. */
  const str = (k: string): string | undefined => {
    const v = raw(k);
    return v && v !== "any" ? v : undefined;
  };
  const cities = str("cities");
  const water = str("water");
  return {
    tenureYearsMin: num("tenure"),
    roofAgeMin: num("roof"),
    water: water === "waterfront" || water === "proximate" ? water : undefined,
    transitMaxM: num("transit"),
    starbucksMaxM: num("starbucks"),
    valueMin: num("valueMin"),
    valueMax: num("valueMax"),
    cities: cities ? cities.split(",").filter(Boolean) : undefined,
    ownerRegion: str("owner"),
    portfolioMin: num("portfolio"),
    // Deliberately reads the raw param: `str` maps "any" to undefined, so
    // comparing its result against "any" was always true — which made
    // residentialOnly impossible to turn off and made an empty criteria set
    // look non-empty to every caller that checks whether one was supplied.
    residentialOnly: raw("usage") !== "any",
  };
}

/** True when the user actually asked for something, rather than landing on a bare page. */
export function hasAnyFacet(c: Criteria): boolean {
  return facetsFor(c).length > 0;
}

export function paramsFromCriteria(c: Criteria): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  };
  set("tenure", c.tenureYearsMin);
  set("roof", c.roofAgeMin);
  set("water", c.water);
  set("transit", c.transitMaxM);
  set("starbucks", c.starbucksMaxM);
  set("valueMin", c.valueMin);
  set("valueMax", c.valueMax);
  set("cities", c.cities?.join(","));
  set("owner", c.ownerRegion);
  set("portfolio", c.portfolioMin);
  if (c.residentialOnly === false) p.set("usage", "any");
  return p;
}
