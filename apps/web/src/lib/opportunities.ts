import "server-only";

import { all, lit, nextId, one, run } from "./db";

/**
 * The acquisition workflow.
 *
 * Stages are a fixed, ordered list rather than free text: the point of a
 * pipeline is that "how many deals are in negotiation" has one answer.
 * "Dead" sits outside the ordering — a deal can die from any stage, and
 * counting it as progress would flatter every funnel metric.
 */
export const STAGES = [
  "Identified",
  "Contacted",
  "Negotiating",
  "Under Contract",
  "Closed",
] as const;
export const DEAD = "Dead";
export const ALL_STAGES = [...STAGES, DEAD] as const;
export type Stage = (typeof ALL_STAGES)[number];

export function isStage(value: string): value is Stage {
  return (ALL_STAGES as readonly string[]).includes(value);
}

export interface Opportunity {
  opportunity_id: string;
  folio: string;
  address: string | null;
  owner_name: string | null;
  stage: Stage;
  match_score: number | null;
  match_rationale: string | null;
  source_search_id: string | null;
  source_run_id: string | null;
  owner_interest: string | null;
  asking_price: number | null;
  offer_price: number | null;
  assigned_to: string | null;
  next_step: string | null;
  created_at: string;
  updated_at: string;
}

export async function listOpportunities(filter?: {
  stage?: string;
  minScore?: number;
  city?: string;
  searchId?: string;
}): Promise<Opportunity[]> {
  const where: string[] = [];
  if (filter?.stage && isStage(filter.stage))
    where.push(`stage = ${lit(filter.stage)}`);
  if (filter?.minScore !== undefined && Number.isFinite(filter.minScore))
    where.push(`COALESCE(match_score, 0) >= ${Math.round(filter.minScore)}`);
  if (filter?.city)
    where.push(`upper(address) LIKE ${lit(`%${filter.city.toUpperCase()}%`)}`);
  if (filter?.searchId)
    where.push(`source_search_id = ${lit(filter.searchId)}`);

  return all<Opportunity>(`
    SELECT * FROM opportunities
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY COALESCE(match_score, 0) DESC, updated_at DESC
  `);
}

export async function getOpportunity(
  id: string,
): Promise<Opportunity | undefined> {
  return one<Opportunity>(
    `SELECT * FROM opportunities WHERE opportunity_id = ${lit(id)}`,
  );
}

export async function getOpportunityByFolio(
  folio: string,
): Promise<Opportunity | undefined> {
  return one<Opportunity>(
    `SELECT * FROM opportunities WHERE folio = ${lit(folio)}`,
  );
}

/**
 * Convert a matched property into a tracked opportunity.
 *
 * The match score and its rationale are copied onto the opportunity at
 * conversion time rather than recomputed later, because they are the reason
 * the deal was opened. Criteria get edited; why someone opened a deal in
 * March should still read correctly in June.
 */
export async function convertToOpportunity(input: {
  folio: string;
  address?: string | null;
  ownerName?: string | null;
  score?: number;
  rationale?: string[];
  searchId?: string;
  runId?: string;
  assignedTo?: string;
}): Promise<string> {
  const existing = await getOpportunityByFolio(input.folio);
  if (existing) return existing.opportunity_id;

  const id = await nextId("opp");
  await run(`
    INSERT INTO opportunities
      (opportunity_id, folio, address, owner_name, stage, match_score,
       match_rationale, source_search_id, source_run_id, assigned_to)
    VALUES (${lit(id)}, ${lit(input.folio)}, ${lit(input.address ?? null)},
            ${lit(input.ownerName ?? null)}, 'Identified', ${lit(input.score ?? null)},
            ${lit(input.rationale?.join(" · ") ?? null)}, ${lit(input.searchId ?? null)},
            ${lit(input.runId ?? null)}, ${lit(input.assignedTo ?? null)})
  `);
  await run(`
    INSERT INTO stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
    VALUES (${lit(id)}, NULL, 'Identified', ${lit(input.assignedTo ?? null)},
            ${lit(input.runId ? `Created from pipeline run ${input.runId}` : "Created from search results")})
  `);
  return id;
}

export async function advanceStage(input: {
  opportunityId: string;
  toStage: Stage;
  changedBy?: string;
  note?: string;
}): Promise<void> {
  const current = await getOpportunity(input.opportunityId);
  if (!current) throw new Error(`No opportunity ${input.opportunityId}`);
  if (current.stage === input.toStage) return;

  await run(`
    UPDATE opportunities
       SET stage = ${lit(input.toStage)}, updated_at = now()
     WHERE opportunity_id = ${lit(input.opportunityId)}
  `);
  await run(`
    INSERT INTO stage_history (opportunity_id, from_stage, to_stage, changed_by, note)
    VALUES (${lit(input.opportunityId)}, ${lit(current.stage)}, ${lit(input.toStage)},
            ${lit(input.changedBy ?? null)}, ${lit(input.note ?? null)})
  `);
}

export async function updateDeal(input: {
  opportunityId: string;
  ownerInterest?: string;
  askingPrice?: number;
  offerPrice?: number;
  nextStep?: string;
  assignedTo?: string;
}): Promise<void> {
  const sets: string[] = ["updated_at = now()"];
  if (input.ownerInterest !== undefined)
    sets.push(`owner_interest = ${lit(input.ownerInterest)}`);
  if (input.askingPrice !== undefined)
    sets.push(`asking_price = ${lit(input.askingPrice)}`);
  if (input.offerPrice !== undefined)
    sets.push(`offer_price = ${lit(input.offerPrice)}`);
  if (input.nextStep !== undefined)
    sets.push(`next_step = ${lit(input.nextStep)}`);
  if (input.assignedTo !== undefined)
    sets.push(`assigned_to = ${lit(input.assignedTo)}`);

  await run(`
    UPDATE opportunities SET ${sets.join(", ")}
     WHERE opportunity_id = ${lit(input.opportunityId)}
  `);
}

export interface StageChange {
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  note: string | null;
  changed_at: string;
}

export async function stageHistory(id: string): Promise<StageChange[]> {
  return all<StageChange>(`
    SELECT from_stage, to_stage, changed_by, note, changed_at
      FROM stage_history WHERE opportunity_id = ${lit(id)}
     ORDER BY changed_at ASC
  `);
}

export interface Note {
  note_id: string;
  body: string;
  author_id: string | null;
  created_at: string;
}

export async function addNote(input: {
  opportunityId: string;
  body: string;
  authorId?: string;
}): Promise<void> {
  const id = await nextId("note");
  await run(`
    INSERT INTO notes (note_id, opportunity_id, author_id, body)
    VALUES (${lit(id)}, ${lit(input.opportunityId)}, ${lit(input.authorId ?? null)}, ${lit(input.body)})
  `);
  await run(
    `UPDATE opportunities SET updated_at = now() WHERE opportunity_id = ${lit(input.opportunityId)}`,
  );
}

export async function listNotes(id: string): Promise<Note[]> {
  return all<Note>(`
    SELECT note_id, body, author_id, created_at FROM notes
     WHERE opportunity_id = ${lit(id)} ORDER BY created_at DESC
  `);
}

export interface Task {
  task_id: string;
  title: string;
  assigned_to: string | null;
  due_on: string | null;
  done: boolean;
  created_at: string;
}

export async function addTask(input: {
  opportunityId: string;
  title: string;
  assignedTo?: string;
  dueOn?: string;
}): Promise<void> {
  const id = await nextId("task");
  await run(`
    INSERT INTO tasks (task_id, opportunity_id, title, assigned_to, due_on)
    VALUES (${lit(id)}, ${lit(input.opportunityId)}, ${lit(input.title)},
            ${lit(input.assignedTo ?? null)},
            ${input.dueOn ? `DATE ${lit(input.dueOn)}` : "NULL"})
  `);
}

export async function toggleTask(taskId: string): Promise<void> {
  await run(`UPDATE tasks SET done = NOT done WHERE task_id = ${lit(taskId)}`);
}

export async function listTasks(id: string): Promise<Task[]> {
  return all<Task>(`
    SELECT task_id, title, assigned_to, CAST(due_on AS VARCHAR) AS due_on, done, created_at
      FROM tasks WHERE opportunity_id = ${lit(id)}
     ORDER BY done ASC, due_on ASC NULLS LAST, created_at ASC
  `);
}

export interface User {
  user_id: string;
  name: string;
  role: string;
}

export async function listUsers(): Promise<User[]> {
  return all<User>(`SELECT user_id, name, role FROM users ORDER BY name`);
}
