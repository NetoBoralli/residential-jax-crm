import Link from "next/link";

import { saveSearchAction } from "@/app/actions";
import { ParcelMap, type MapPoint } from "@/components/parcel-map";
import {
  MatchScore,
  OracleDown,
  Provenance,
  money,
  num,
} from "@/components/ui";
import {
  criteriaFromParams,
  describe,
  hasAnyFacet,
  paramsFromCriteria,
} from "@/lib/criteria";
import { OracleUnavailable } from "@/lib/oracle-client";
import { runSearch } from "@/lib/searches";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * How many matches are fetched, plotted and listed.
 *
 * One number, used everywhere. Previously the banner quoted the fetched count,
 * the table sliced to 60 and the map plotted all 150 — three numbers for one
 * result set, on a page whose own header comment promised they were the same.
 */
const SHOWN = 100;

const CITIES = [
  "JACKSONVILLE",
  "JACKSONVILLE BEACH",
  "ATLANTIC BEACH",
  "NEPTUNE BEACH",
  "PONTE VEDRA BEACH",
];

/**
 * Find properties.
 *
 * Every control is a plain form field and every result state is a URL, so the
 * whole surface is reachable by link and drivable without a mouse. The map
 * and the list render from the same result set — the list is authoritative.
 */
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const criteria = criteriaFromParams(params);
  // Whether the user actually asked for something. Checking "any field is set"
  // was always true, because residentialOnly defaults on — so the empty page
  // offered to save a criteria set with no criteria in it.
  const hasFacets = hasAnyFacet(criteria);

  let result;
  let error: string | undefined;
  try {
    result = await runSearch(criteria, { limit: SHOWN });
  } catch (e) {
    error =
      e instanceof OracleUnavailable || e instanceof Error
        ? e.message
        : String(e);
  }

  const points: MapPoint[] =
    result?.rows
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => ({
        folio: r.request_identifier,
        lat: Number(r.latitude),
        lon: Number(r.longitude),
        label: `${r.address_street ?? r.request_identifier} — ${money(r.market_value)}`,
        score: r._score,
      })) ?? [];

  const qs = paramsFromCriteria(criteria).toString();

  return (
    <>
      <h1>Find properties</h1>
      <p className="lede">
        Criteria run against the live Duval dataset through the Oracle&rsquo;s
        MCP surface. Everything listed meets every criterion you set — the
        signal score ranks how far past your thresholds each one sits, and the
        clauses beneath it say why, so you can disagree with the ranking rather
        than trust it.
      </p>

      <form
        method="get"
        className="card"
        style={{ marginTop: 20 }}
        data-testid="criteria-form"
      >
        <h3>Acquisition criteria</h3>
        <div className="filters" style={{ marginTop: 14 }}>
          <div>
            <label htmlFor="tenure">Held at least</label>
            <select
              id="tenure"
              name="tenure"
              defaultValue={(params["tenure"] as string) ?? ""}
            >
              <option value="">Any tenure</option>
              <option value="10">10+ years</option>
              <option value="15">15+ years</option>
              <option value="20">20+ years</option>
            </select>
          </div>
          <div>
            <label htmlFor="roof">Roof age</label>
            <select
              id="roof"
              name="roof"
              defaultValue={(params["roof"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="15">15+ years</option>
              <option value="25">25+ years</option>
              <option value="40">40+ years</option>
            </select>
          </div>
          <div>
            <label htmlFor="owner">Owner locality</label>
            <select
              id="owner"
              name="owner"
              defaultValue={(params["owner"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="out_of_state">Out of state</option>
              <option value="regional_ne_florida">Regional NE Florida</option>
              <option value="regional_florida">Elsewhere in Florida</option>
              <option value="any_non_local">Any non-local</option>
              <option value="local_duval">Local to Duval</option>
            </select>
          </div>
          <div>
            <label htmlFor="portfolio">Owner portfolio</label>
            <select
              id="portfolio"
              name="portfolio"
              defaultValue={(params["portfolio"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="2">2+ parcels</option>
              <option value="5">5+ parcels</option>
              <option value="10">10+ parcels</option>
            </select>
          </div>
          <div>
            <label htmlFor="water">Water</label>
            <select
              id="water"
              name="water"
              defaultValue={(params["water"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="waterfront">Waterfront</option>
              <option value="proximate">Within 150 m of water</option>
            </select>
          </div>
          <div>
            <label htmlFor="transit">Transit within</label>
            <select
              id="transit"
              name="transit"
              defaultValue={(params["transit"] as string) ?? ""}
            >
              <option value="">Any</option>
              <option value="400">400 m</option>
              <option value="800">800 m</option>
            </select>
          </div>
          <div>
            <label htmlFor="cities">City</label>
            <select
              id="cities"
              name="cities"
              defaultValue={(params["cities"] as string) ?? ""}
            >
              <option value="">Any</option>
              {CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="valueMin">Just value from</label>
            <input
              id="valueMin"
              name="valueMin"
              type="number"
              min="0"
              step="10000"
              placeholder="100000"
              defaultValue={(params["valueMin"] as string) ?? ""}
            />
          </div>
          <div>
            <label htmlFor="valueMax">Just value to</label>
            <input
              id="valueMax"
              name="valueMax"
              type="number"
              min="0"
              step="10000"
              placeholder="450000"
              defaultValue={(params["valueMax"] as string) ?? ""}
            />
          </div>
          <div>
            <button className="btn" type="submit" data-testid="search-submit">
              Search
            </button>
          </div>
        </div>
      </form>

      {error ? (
        <div style={{ marginTop: 24 }}>
          <OracleDown error={error} />
        </div>
      ) : (
        <>
          <div
            className="row-actions"
            style={{ marginTop: 24, justifyContent: "space-between" }}
          >
            <div>
              <span className="stat-value" data-testid="result-count">
                {num(result?.total)}
              </span>{" "}
              <span className="muted">
                properties match — {describe(criteria)}
              </span>
              {result && result.total > result.rows.length ? (
                <div className="subtle" style={{ marginTop: 4 }}>
                  Listing and mapping the top {num(result.rows.length)} by match
                  score, then by just value. Narrow the criteria to see further
                  in, or export the full set from a saved criteria set.
                </div>
              ) : null}
            </div>
            {hasFacets ? (
              <form action={saveSearchAction} data-testid="save-search-form">
                {[...paramsFromCriteria(criteria).entries()].map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <input
                  name="name"
                  placeholder="Name this criteria set"
                  defaultValue={describe(criteria).slice(0, 60)}
                  style={{ marginRight: 8 }}
                  aria-label="Criteria set name"
                />
                <button className="btn" type="submit" data-testid="save-search">
                  Save &amp; watch
                </button>
              </form>
            ) : null}
          </div>

          <div className="stack" style={{ marginTop: 18 }}>
            <ParcelMap points={points} height={520} />
            <div style={{ overflowX: "auto" }}>
              <table data-testid="results-table">
                <thead>
                  <tr>
                    <th>Address</th>
                    <th>Owner</th>
                    <th className="num">Just value</th>
                    <th>Match</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {result?.rows.map((r) => (
                    <tr key={r.request_identifier}>
                      <td>
                        <Link
                          href={`/properties/${encodeURIComponent(r.request_identifier)}?${qs}`}
                        >
                          {r.address_street ?? r.request_identifier}
                        </Link>
                        <div className="subtle">
                          {r.address_city ?? "—"} · {r.request_identifier}
                        </div>
                      </td>
                      <td>{r.owner_name ?? "—"}</td>
                      <td className="num">{money(r.market_value)}</td>
                      <td>
                        <MatchScore score={r._score} rationale={r._rationale} />
                      </td>
                      <td>
                        <Link
                          className="btn btn-secondary"
                          href={`/properties/${encodeURIComponent(r.request_identifier)}?${qs}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {result?.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="muted">
                        Nothing matches these criteria. That is an answer, not
                        an error — loosen a threshold and search again.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          {result ? (
            <Provenance
              sql={result.sql}
              durationMs={result.durationMs}
              detail={result.provenance as Record<string, unknown>}
            />
          ) : null}
        </>
      )}
    </>
  );
}
