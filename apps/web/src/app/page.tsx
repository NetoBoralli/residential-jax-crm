export const dynamic = "force-dynamic";

export default function MapPage() {
  return (
    <>
      <h1>Residential Property Acquisition CRM</h1>
      <p className="muted" style={{ maxWidth: "68ch", marginTop: 8 }}>
        Target-fit and distressed residential properties across Jacksonville and
        greater Duval County, driven by the continuous Duval Oracle pipeline. Define
        acquisition criteria, get notified when the pipeline surfaces new matches, and
        run the deal from identification through close.
      </p>

      <div className="card" style={{ marginTop: 24 }} data-testid="build-status">
        <h2>Deployment live</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          This runtime is deployed and reachable. The map, criteria matching and
          notification loop come online as the upstream Duval pipeline publishes its
          first artifacts.
        </p>
      </div>
    </>
  );
}
