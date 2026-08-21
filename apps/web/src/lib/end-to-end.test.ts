import { beforeAll, describe, expect, it } from "vitest";

import { all, run } from "./db";
import { listPipelineRuns } from "./oracle-client";
import {
  advanceStage,
  convertToOpportunity,
  getOpportunity,
  listNotes,
  addNote,
  stageHistory,
} from "./opportunities";
import {
  advanceOutreach,
  draftOutreach,
  listOutreach,
  template,
} from "./outreach";
import {
  checkSearchAgainstRun,
  getSearch,
  runSearch,
  saveSearch,
} from "./searches";

/**
 * The flow the assignment asks to be demonstrated, as a test.
 *
 * criteria → search → save criteria → pipeline run → proactive notification →
 * convert to opportunity → mocked outreach → advance stage.
 *
 * It talks to the real Oracle, so it is opt-in: set ORACLE_MCP_URL (and
 * CRM_DATA_DIR to somewhere disposable) to run it. Skipped otherwise, because
 * a test that silently depends on a network service is worse than no test —
 * it fails for reasons that have nothing to do with the code under review.
 *
 *   ORACLE_MCP_URL=https://…/mcp CRM_DATA_DIR=/tmp/crm-e2e pnpm test
 */
const LIVE = Boolean(process.env["ORACLE_MCP_URL"]);

describe.skipIf(!LIVE)("acquisition flow, end to end", () => {
  let runId: string;
  let searchId: string;
  let opportunityId: string;

  const criteria = {
    tenureYearsMin: 10,
    roofAgeMin: 15,
    ownerRegion: "out_of_state",
    valueMax: 400_000,
  };

  beforeAll(async () => {
    // A run that actually changed something — a no-op run correctly produces no
    // alerts, which would make this test pass for the wrong reason.
    const { runs } = await listPipelineRuns(25);
    const changed = runs.find(
      (r) =>
        r.status === "success" && Number(r.inserts) + Number(r.updates) > 0,
    );
    expect(
      changed,
      "no run in the published history changed anything",
    ).toBeDefined();
    runId = changed!.run_id;
  });

  it("finds properties matching acquisition criteria", async () => {
    const result = await runSearch(criteria, { limit: 25 });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.length).toBeGreaterThan(0);
    // Every returned row must satisfy the filter, and say why.
    for (const row of result.rows) {
      expect(row._score).toBeGreaterThan(0);
      expect(row._rationale.length).toBeGreaterThan(0);
      expect(Number(row.market_value)).toBeLessThanOrEqual(400_000);
    }
    // Ranked by match strength.
    const scores = result.rows.map((r) => r._score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("saves the criteria set with the expression the Oracle will evaluate", async () => {
    searchId = await saveSearch({
      name: "E2E — long-held, aging roof, out-of-state owner",
      criteria,
      ownerId: "u-dana",
    });
    const saved = await getSearch(searchId);
    expect(saved?.where_sql).toContain("owner_region_class");
    expect(saved?.where_sql).toContain("roof_age_years");
    expect(saved?.notify).toBe(true);
  });

  it("raises an alert tied to a specific run and its changes artifact", async () => {
    const search = await getSearch(searchId);
    const result = await checkSearchAgainstRun(search!, runId);

    expect(result.changedInRun).toBeGreaterThan(0);
    expect(result.matched).toBeGreaterThan(0);
    expect(result.notificationId).toBeDefined();

    const [alert] = await all<{ run_id: string; changes_cid: string }>(
      `SELECT run_id, changes_cid FROM notifications WHERE notification_id = '${result.notificationId}'`,
    );
    expect(alert?.run_id).toBe(runId);
    // The evidence is content-addressed, so the alert cannot be quietly rewritten.
    expect(alert?.changes_cid).toMatch(/^Qm|^bafy/);

    const matches = await all(
      `SELECT * FROM notification_matches WHERE notification_id = '${result.notificationId}'`,
    );
    expect(matches.length).toBeGreaterThan(0);
  });

  it("does not raise a second alert for the same run", async () => {
    const search = await getSearch(searchId);
    const again = await checkSearchAgainstRun(search!, runId);
    expect(again.alreadySeen).toBe(true);

    const [{ n }] = await all<{ n: number }>(
      `SELECT count(*) AS n FROM notifications WHERE search_id = '${searchId}' AND run_id = '${runId}'`,
    );
    expect(Number(n)).toBe(1);
  });

  it("converts a matched property into a tracked opportunity", async () => {
    const [match] = await all<{
      folio: string;
      address: string;
      owner_name: string;
    }>(
      `SELECT m.folio, m.address, m.owner_name
         FROM notification_matches m
         JOIN notifications n USING (notification_id)
        WHERE n.search_id = '${searchId}' LIMIT 1`,
    );
    expect(match).toBeDefined();

    opportunityId = await convertToOpportunity({
      folio: match!.folio,
      address: match!.address,
      ownerName: match!.owner_name,
      score: 90,
      rationale: [
        "held 10+ years",
        "roof ~30 years",
        "owner mails to Atlanta, GA",
      ],
      searchId,
      runId,
    });

    const opp = await getOpportunity(opportunityId);
    expect(opp?.stage).toBe("Identified");
    // The reason the deal was opened travels with it.
    expect(opp?.source_run_id).toBe(runId);
    expect(opp?.match_rationale).toContain("roof");
  });

  it("is idempotent on conversion — one deal per folio", async () => {
    const opp = await getOpportunity(opportunityId);
    const again = await convertToOpportunity({ folio: opp!.folio });
    expect(again).toBe(opportunityId);
  });

  it("drafts mocked outreach and walks its lifecycle in order", async () => {
    const opp = await getOpportunity(opportunityId);
    const drafted = template({
      channel: "direct_mail",
      ownerName: opp!.owner_name,
      address: opp!.address,
      rationale: opp!.match_rationale,
    });
    // The letter says where the data came from — it would be defensible if sent.
    expect(drafted.body).toContain("Duval County public records");

    const outreachId = await draftOutreach({
      opportunityId,
      channel: "direct_mail",
      subject: drafted.subject ?? "",
      body: drafted.body,
    });

    await advanceOutreach(outreachId, "printed");
    await advanceOutreach(outreachId, "mailed");

    const [msg] = await listOutreach(opportunityId);
    expect(msg?.status).toBe("mailed");

    // A letter cannot go backwards, and cannot reach a state email owns.
    await expect(advanceOutreach(outreachId, "printed")).rejects.toThrow(
      /cannot go from/,
    );
    await expect(advanceOutreach(outreachId, "opened")).rejects.toThrow(
      /not a state/,
    );
  });

  it("advances the deal through stages with an audit trail", async () => {
    await advanceStage({
      opportunityId,
      toStage: "Contacted",
      changedBy: "u-dana",
      note: "Letter mailed",
    });
    await advanceStage({
      opportunityId,
      toStage: "Negotiating",
      changedBy: "u-marcus",
      note: "Owner called back, open to an offer",
    });
    await addNote({
      opportunityId,
      body: "Inherited in 2011, never occupied it.",
      authorId: "u-marcus",
    });

    const opp = await getOpportunity(opportunityId);
    expect(opp?.stage).toBe("Negotiating");

    const history = await stageHistory(opportunityId);
    expect(history.map((h) => h.to_stage)).toEqual([
      "Identified",
      "Contacted",
      "Negotiating",
    ]);
    expect(history.at(-1)?.changed_by).toBe("u-marcus");
    expect((await listNotes(opportunityId)).length).toBe(1);
  });

  it("leaves the workspace queryable for the dashboard", async () => {
    const [counts] = await all<{
      searches: number;
      alerts: number;
      opps: number;
    }>(`
      SELECT (SELECT count(*) FROM saved_searches) AS searches,
             (SELECT count(*) FROM notifications)   AS alerts,
             (SELECT count(*) FROM opportunities)   AS opps
    `);
    expect(Number(counts?.searches)).toBeGreaterThan(0);
    expect(Number(counts?.alerts)).toBeGreaterThan(0);
    expect(Number(counts?.opps)).toBeGreaterThan(0);
    await run(`SELECT 1`);
  });
});
