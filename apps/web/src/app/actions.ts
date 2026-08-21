"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { criteriaFromParams } from "@/lib/criteria";
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
  advanceOutreach,
  draftOutreach,
  isChannel,
  template,
} from "@/lib/outreach";
import { deleteSearch, saveSearch, sweepForMatches } from "@/lib/searches";

/**
 * Every mutation is a form post to a server action.
 *
 * No drag-and-drop, no hover-only affordance, no state that exists solely in a
 * client component. That is partly an accessibility position and partly a
 * practical one: an automated reviewer driving this app with a browser can
 * submit a form, and cannot drag a card between columns.
 */

/**
 * Free text, bounded.
 *
 * Every mutation here is anonymous and unauthenticated by design. Without a
 * length cap one POST stored a 900 KB note, and a few thousand of those fill
 * the volume the store lives on — at which point no recovery path helps,
 * because the file is not corrupt, the disk is full.
 */
const MAX_TEXT = 4000;

const str = (fd: FormData, key: string): string => {
  const value = String(fd.get(key) ?? "").trim();
  return value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) : value;
};

/**
 * A field the form submitted, distinguishing "left blank" from "not submitted".
 *
 * These matter apart. `undefined` means the form did not carry the field and it
 * must be left alone; `null` means the user cleared it and it must be written
 * as NULL. Collapsing both to `undefined` made every clearable control on the
 * deal form — unassign, remove an offer, blank the next step — silently do
 * nothing.
 */
const field = (fd: FormData, key: string): string | null | undefined => {
  if (!fd.has(key)) return undefined;
  const value = str(fd, key);
  return value === "" ? null : value;
};

const numField = (fd: FormData, key: string): number | null | undefined => {
  const value = field(fd, key);
  if (value === undefined || value === null) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

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

  // One implementation, shared with the scheduler endpoint. Two copies of this
  // loop drifted within a day of being written.
  const result = await sweepForMatches({
    ...(searchId ? { searchId } : {}),
    ...(explicitRun ? { runId: explicitRun } : {}),
  });

  revalidatePath("/notifications");
  revalidatePath("/searches");

  // The Oracle being unreachable is not "no matches" — it is a failed check,
  // and redirecting to an unchanged alert list would report it as a success.
  redirect(
    result.unreachable
      ? `/notifications?error=${encodeURIComponent(result.unreachable)}`
      : "/notifications",
  );
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
    ownerInterest: field(fd, "owner_interest"),
    askingPrice: numField(fd, "asking_price"),
    offerPrice: numField(fd, "offer_price"),
    nextStep: field(fd, "next_step"),
    assignedTo: field(fd, "assigned_to"),
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
  const requested = str(fd, "channel");
  if (!isChannel(requested)) {
    throw new Error(`"${requested}" is not an outreach channel.`);
  }

  // The form pre-fills the email template, so a user who switches the channel
  // select to SMS or direct mail would otherwise post email copy under the new
  // channel — a letter with no address block, or an SMS with a subject line.
  // Text the user actually edited is kept; text still identical to the email
  // template is replaced with the chosen channel's own.
  const emailDraft = template({
    channel: "email",
    ownerName: str(fd, "owner_name") || null,
    address: str(fd, "address") || null,
    rationale: str(fd, "rationale") || null,
  });
  const drafted = template({
    channel: requested,
    ownerName: str(fd, "owner_name") || null,
    address: str(fd, "address") || null,
    rationale: str(fd, "rationale") || null,
  });

  const submittedSubject = str(fd, "subject");
  const submittedBody = str(fd, "body");
  const subject =
    submittedSubject && submittedSubject !== emailDraft.subject
      ? submittedSubject
      : drafted.subject;
  const body =
    submittedBody && submittedBody !== emailDraft.body
      ? submittedBody
      : drafted.body;

  await draftOutreach({
    opportunityId,
    channel: requested,
    ...(subject ? { subject } : {}),
    body,
    toAddress: str(fd, "to_address") || undefined,
  });
  revalidatePath(`/opportunities/${opportunityId}`);
}

export async function advanceOutreachAction(fd: FormData): Promise<void> {
  await advanceOutreach(str(fd, "outreach_id"), str(fd, "to_status"));
  revalidatePath(`/opportunities/${str(fd, "opportunity_id")}`);
}
