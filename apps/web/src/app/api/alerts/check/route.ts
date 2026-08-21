import { sweepForMatches } from "@/lib/searches";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * Run every watched criteria set against recent pipeline runs.
 *
 * The assignment asks for saved searches that run against the continuous
 * pipeline "on an ongoing basis". A button in the UI is not that; an endpoint a
 * scheduler can hit is. This is the same sweep the button performs, so there is
 * one code path rather than a UI version and a cron version that drift.
 *
 * Safe to call repeatedly and safe to expose without a mutation guard, because
 * it is idempotent by construction: alerts are unique per (criteria set, run),
 * so a second call over the same runs writes nothing. It cannot be used to
 * create unbounded state — the number of possible alerts is bounded by the
 * number of criteria sets times the number of published runs.
 *
 * The sweep itself lives in lib/searches.ts and is shared with the UI button.
 * It was briefly duplicated here, and the two copies drifted in how they
 * reported a skipped run before either was ever called twice.
 */
export async function GET(): Promise<Response> {
  return sweep();
}

export async function POST(): Promise<Response> {
  return sweep();
}

async function sweep(): Promise<Response> {
  const result = await sweepForMatches();

  if (result.unreachable) {
    return Response.json(
      {
        status: "error",
        message: result.unreachable,
        note: "The Duval Oracle could not be reached, so nothing was checked. This is not a report that nothing matched.",
      },
      { status: 503 },
    );
  }

  return Response.json({
    status: "ok",
    watchedSearches: result.watchedSearches,
    runsChecked: result.runsChecked,
    alertsRaised: result.alerts.filter(
      (a) => a.notificationId && !a.alreadySeen,
    ).length,
    results: result.alerts
      .filter((a) => a.notificationId && !a.alreadySeen)
      .map((a) => ({
        searchId: a.searchId,
        runId: a.runId,
        changedInRun: a.changedInRun,
        matched: a.matched,
        notificationId: a.notificationId,
      })),
    skipped: result.skipped,
    durationMs: result.durationMs,
  });
}
