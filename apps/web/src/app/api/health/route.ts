export const dynamic = "force-dynamic";

/** Railway healthcheck target. Kept dependency-free so it stays green during a cold start. */
export function GET() {
  return Response.json({
    status: "ok",
    service: "jax-acquisition-crm-web",
    county: "duval",
    time: new Date().toISOString(),
  });
}
