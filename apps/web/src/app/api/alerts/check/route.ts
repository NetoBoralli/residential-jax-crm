import { listPipelineRuns } from "@/lib/oracle-client";
import { checkSearchAgainstRun, listSearches } from "@/lib/searches";

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
 */
export async function GET(): Promise<Response> {
  return sweep();
}

export async function POST(): Promise<Response> {
  return sweep();
}

async function sweep(): Promise<Response> {
  const started = Date.now();

  try {
    const [{ runs }, searches] = await Promise.all([
      listPipelineRuns(25),
      listSearches(),
    ]);

    const watched = searches.filter((s) => s.notify);
    // Oldest first, so a first-time sweep produces alerts in the order the runs
    // actually happened rather than backwards.
    const candidates = runs
      .filter((r) => r.status === "success")
      .slice(0, 5)
      .reverse();

    const results: Array<Record<string, unknown>> = [];
    for (const search of watched) {
      for (const run of candidates) {
        try {
          const result = await checkSearchAgainstRun(search, run.run_id);
          if (result.matched > 0 && !result.alreadySeen) {
            results.push({
              searchId: search.search_id,
              searchName: search.name,
              runId: run.run_id,
              changedInRun: result.changedInRun,
              matched: result.matched,
              notificationId: result.notificationId,
            });
          }
        } catch (error) {
          // A run published before change tracking existed has no changes
          // artifact. That is a fact about that run, not a failure of the
          // sweep, so the remaining runs still get checked.
          results.push({
            searchId: search.search_id,
            runId: run.run_id,
            skipped: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return Response.json({
      status: "ok",
      watchedSearches: watched.length,
      runsChecked: candidates.length,
      alertsRaised: results.filter((r) => r["notificationId"]).length,
      results,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
