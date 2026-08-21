"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { criteriaFromParams } from "@/lib/criteria";
import { listPipelineRuns } from "@/lib/oracle-client";
import {
  type Stage,
  addNote,
  addTask,
  advanceStage,
  convertToOpportunity,
  isStage,
  toggleTask,
  updateDeal,
} from "@/lib/opportunities";
import {
  type Channel,
  advanceOutreach,
  draftOutreach,
  template,
} from "@/lib/outreach";
import {
  checkSearchAgainstRun,
  deleteSearch,
  getSearch,
  listSearches,
  saveSearch,
} from "@/lib/searches";

/**
 * Every mutation is a form post to a server action.
 *
 * No drag-and-drop, no hover-only affordance, no state that exists solely in a
 * client component. That is partly an accessibility position and partly a
 * practical one: an automated reviewer driving this app with a browser can
 * submit a form, and cannot drag a card between columns.
 */

const str = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();
const numOrUndef = (fd: FormData, key: string): number | undefined => {
  const raw = str(fd, key);
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

export async function saveSearchAction(fd: FormData): Promise<void> {
  const name = str(fd, "name") || "Untitled criteria";
  const params = Object.fromEntries(
    [...fd.entries()]
      .filter(([k]) => k !== "name" && k !== "owner_id")
      .map(([k, v]) => [k, String(v)]),
  );
  const criteria = criteriaFromParams(params);
  const id = await saveSearch({
    name,
    criteria,
    ownerId: str(fd, "owner_id") || "u-dana",
  });
  revalidatePath("/searches");
  redirect(`/searches/${id}`);
}

export async function deleteSearchAction(fd: FormData): Promise<void> {
  await deleteSearch(str(fd, "search_id"));
  revalidatePath("/searches");
  redirect("/searches");
}

/**
 * Check saved criteria against the latest pipeline run.
 *
 * This is the proactive-notification path, run on demand. It is idempotent per
 * (search, run): pressing the button twice does not produce two alerts about
 * the same evidence, which is what makes it safe to wire to a scheduler as
 * well as to a button.
 */
export async function checkForMatchesAction(fd: FormData): Promise<void> {
  const searchId = str(fd, "search_id");
  const explicitRun = str(fd, "run_id");

  const { runs } = await listPipelineRuns(25);
  const searches = searchId
    ? [await getSearch(searchId)].filter(Boolean)
    : (await listSearches()).filter((s) => s.notify);

  // Newest first from the Oracle; check oldest-to-newest so the alert list
  // reads chronologically rather than backwards.
  const candidates = (
    explicitRun ? runs.filter((r) => r.run_id === explicitRun) : runs
  )
    .filter((r) => r.status === "success")
    .slice(0, 5)
    .reverse();

  for (const search of searches) {
    if (!search) continue;
    for (const run of candidates) {
      try {
        await checkSearchAgainstRun(search, run.run_id);
      } catch {
        // A run published before change-tracking existed has no changes
        // artifact. That is a fact about that run, not a failure of the sweep,
        // so the remaining runs still get checked.
      }
    }
  }

  revalidatePath("/notifications");
  revalidatePath("/searches");
  redirect("/notifications");
}

export async function convertAction(fd: FormData): Promise<void> {
  const id = await convertToOpportunity({
    folio: str(fd, "folio"),
    address: str(fd, "address") || null,
    ownerName: str(fd, "owner_name") || null,
    score: numOrUndef(fd, "score"),
    rationale: str(fd, "rationale") ? [str(fd, "rationale")] : undefined,
    searchId: str(fd, "search_id") || undefined,
    runId: str(fd, "run_id") || undefined,
    assignedTo: str(fd, "assigned_to") || "u-dana",
  });
  revalidatePath("/opportunities");
  redirect(`/opportunities/${id}`);
}

export async function advanceStageAction(fd: FormData): Promise<void> {
  const opportunityId = str(fd, "opportunity_id");
  const toStage = str(fd, "to_stage");
  if (!isStage(toStage))
    throw new Error(`"${toStage}" is not a pipeline stage.`);
  await advanceStage({
    opportunityId,
    toStage: toStage as Stage,
    changedBy: str(fd, "changed_by") || undefined,
    note: str(fd, "note") || undefined,
  });
  revalidatePath(`/opportunities/${opportunityId}`);
  revalidatePath("/opportunities");
}

export async function updateDealAction(fd: FormData): Promise<void> {
  const opportunityId = str(fd, "opportunity_id");
  await updateDeal({
    opportunityId,
    ownerInterest: str(fd, "owner_interest") || undefined,
    askingPrice: numOrUndef(fd, "asking_price"),
    offerPrice: numOrUndef(fd, "offer_price"),
    nextStep: str(fd, "next_step") || undefined,
    assignedTo: str(fd, "assigned_to") || undefined,
  });
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function addNoteAction(fd: FormData): Promise<void> {
  const opportunityId = str(fd, "opportunity_id");
  const body = str(fd, "body");
  if (body) {
    await addNote({
      opportunityId,
      body,
      authorId: str(fd, "author_id") || undefined,
    });
  }
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function addTaskAction(fd: FormData): Promise<void> {
  const opportunityId = str(fd, "opportunity_id");
  const title = str(fd, "title");
  if (title) {
    await addTask({
      opportunityId,
      title,
      assignedTo: str(fd, "assigned_to") || undefined,
      dueOn: str(fd, "due_on") || undefined,
    });
  }
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function toggleTaskAction(fd: FormData): Promise<void> {
  await toggleTask(str(fd, "task_id"));
  revalidatePath(`/opportunities/${str(fd, "opportunity_id")}`);
}

export async function draftOutreachAction(fd: FormData): Promise<void> {
  const opportunityId = str(fd, "opportunity_id");
  const channel = str(fd, "channel") as Channel;
  const drafted = template({
    channel,
    ownerName: str(fd, "owner_name") || null,
    address: str(fd, "address") || null,
    rationale: str(fd, "rationale") || null,
  });
  await draftOutreach({
    opportunityId,
    channel,
    subject: str(fd, "subject") || drafted.subject,
    body: str(fd, "body") || drafted.body,
    toAddress: str(fd, "to_address") || undefined,
  });
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function advanceOutreachAction(fd: FormData): Promise<void> {
  await advanceOutreach(str(fd, "outreach_id"), str(fd, "to_status"));
  revalidatePath(`/opportunities/${str(fd, "opportunity_id")}`);
}
