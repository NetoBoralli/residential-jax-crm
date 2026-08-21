"use client";

// MapLibre ships its own stylesheet and does not work without it. Popups are
// positioned by that CSS; without it a popup is an unstyled div that lands in
// the document flow and shoves the page apart the moment anyone clicks a pin.
// The zoom and attribution controls are unstyled without it too.
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c] ?? c,
  );
}

export interface MapPoint {
  folio: string;
  lat: number;
  lon: number;
  label: string;
  score?: number;
}

/**
 * The map.
 *
 * Explicitly decoration over evidence: every property plotted here is also a
 * row in the list beside it, with the same values as DOM text. That ordering
 * is deliberate — a map is the fastest way for a human to judge whether a set
 * of candidates is geographically sensible, and the worst possible place to
 * put a number someone has to read, copy, or assert against.
 *
 * MapLibre is loaded dynamically so a failure to load it degrades to a
 * labelled panel rather than taking the page down, and the basemap is CARTO's
 * keyless raster tiles so there is no API key to leak or expire.
 */
export function ParcelMap({
  points,
  height = 460,
}: {
  points: MapPoint[];
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | undefined>();
  const pointsKey = points
    .map((p) => `${p.folio}:${p.lat}:${p.lon}:${p.score ?? ""}`)
    .join(",");

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    let map: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        const maplibre = await import("maplibre-gl");
        if (cancelled || !container.current) return;

        const withCoords = points.filter(
          (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
        );

        const m = new maplibre.Map({
          container: container.current,
          style: {
            version: 8,
            sources: {
              carto: {
                type: "raster",
                tiles: [
                  "https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
                  "https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png",
                ],
                tileSize: 256,
                attribution:
                  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
              },
            },
            layers: [{ id: "carto", type: "raster", source: "carto" }],
          },
          center: [-81.66, 30.33], // Downtown Jacksonville.
          zoom: 9.4,
          attributionControl: { compact: true },
        });
        map = m;
        m.addControl(new maplibre.NavigationControl({ showCompass: false }));

        m.on("load", () => {
          if (withCoords.length === 0) return;
          m.addSource("parcels", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: withCoords.map((p) => ({
                type: "Feature" as const,
                geometry: {
                  type: "Point" as const,
                  coordinates: [p.lon, p.lat],
                },
                properties: {
                  folio: p.folio,
                  label: p.label,
                  score: p.score ?? 0,
                },
              })),
            },
          });
          m.addLayer({
            id: "parcels",
            type: "circle",
            source: "parcels",
            paint: {
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                8,
                3.5,
                14,
                8,
              ],
              // Stronger matches read hotter, so the eye lands on them first.
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "score"],
                0,
                "#6b7689",
                60,
                "#d29922",
                100,
                "#f0883e",
              ],
              "circle-opacity": 0.85,
              "circle-stroke-width": 1,
              "circle-stroke-color": "rgba(0,0,0,0.45)",
            },
          });

          const popup = new maplibre.Popup({
            closeButton: true,
            maxWidth: "260px",
          });
          m.on("click", "parcels", (e) => {
            const f = e.features?.[0];
            if (!f) return;
            const props = f.properties as { folio: string; label: string };
            // Owner names and addresses come from the county roll by way of the
            // Oracle. setHTML parses whatever it is given, so they are escaped
            // rather than trusted — an apostrophe in an owner name is common,
            // and a bracket would otherwise be markup.
            popup
              .setLngLat(e.lngLat)
              .setHTML(
                `<div class="map-popup"><strong>${escapeHtml(props.label)}</strong>` +
                  `<a href="/properties/${encodeURIComponent(props.folio)}">Open ${escapeHtml(props.folio)}</a></div>`,
              )
              .addTo(m);
          });
          m.on("mouseenter", "parcels", () => {
            m.getCanvas().style.cursor = "pointer";
          });
          m.on("mouseleave", "parcels", () => {
            m.getCanvas().style.cursor = "";
          });

          const lons = withCoords.map((p) => p.lon);
          const lats = withCoords.map((p) => p.lat);
          m.fitBounds(
            [
              [Math.min(...lons), Math.min(...lats)],
              [Math.max(...lons), Math.max(...lats)],
            ],
            { padding: 48, maxZoom: 14, duration: 0 },
          );
        });
      } catch (error) {
        if (!cancelled) {
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
    // Keyed by the identity of the plotted set rather than the array itself.
    // `points` is rebuilt on every server render, so depending on it tore the
    // map down and reset the user's pan and zoom on any re-render.
  }, [pointsKey]);

  const plotted = points.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon),
  ).length;

  return (
    <div>
      <div className="map-wrap" style={{ height }} data-testid="parcel-map">
        {failed ? (
          <div className="map-fallback">
            The map could not load ({failed}). Every property plotted on it is
            listed below with the same values.
          </div>
        ) : (
          <div ref={container} style={{ height: "100%" }} />
        )}
      </div>
      <div
        className="subtle"
        style={{ marginTop: 8 }}
        data-testid="map-plotted"
      >
        {plotted.toLocaleString("en-US")} of{" "}
        {points.length.toLocaleString("en-US")} shown on the map
        {plotted < points.length
          ? " — the rest have no parcel centroid in the published geometry vintage."
          : "."}{" "}
        The list below is the authoritative view.
      </div>
    </div>
  );
}
