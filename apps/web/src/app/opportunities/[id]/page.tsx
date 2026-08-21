import Link from "next/link";
import { notFound } from "next/navigation";

import {
  addNoteAction,
  addTaskAction,
  advanceOutreachAction,
  advanceStageAction,
  draftOutreachAction,
  toggleTaskAction,
  updateDealAction,
} from "@/app/actions";
import { StageBadge, money, num, when } from "@/components/ui";
import {
  ALL_STAGES,
  getOpportunity,
  listNotes,
  listTasks,
  listUsers,
  stageHistory,
} from "@/lib/opportunities";
import {
  CHANNELS,
  CHANNEL_LABEL,
  LIFECYCLE,
  listOutreach,
  outreachEvents,
  template,
} from "@/lib/outreach";

export const dynamic = "force-dynamic";

export default async function OpportunityDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const opp = await getOpportunity(id);
  if (!opp) notFound();

  const [history, notes, tasks, users, messages] = await Promise.all([
    stageHistory(id),
    listNotes(id),
    listTasks(id),
    listUsers(),
    listOutreach(id),
  ]);

  const events = await Promise.all(
    messages.map(async (m) => ({
      message: m,
      events: await outreachEvents(m.outreach_id),
    })),
  );

  const draft = template({
    channel: "email",
    ownerName: opp.owner_name,
    address: opp.address,
    rationale: opp.match_rationale,
  });

  return (
    <>
      <h1 data-testid="opp-address">{opp.address ?? opp.folio}</h1>
      <p className="lede">
        <span className="mono">{opp.opportunity_id}</span> ·{" "}
        <Link href={`/properties/${encodeURIComponent(opp.folio)}`}>
          folio {opp.folio}
        </Link>{" "}
        · {opp.owner_name ?? "owner unknown"}
      </p>

      <div className="row-actions" style={{ marginTop: 14 }}>
        <StageBadge stage={opp.stage} />
        {opp.match_score !== null ? (
          <span className="badge badge-info">{opp.match_score}% match</span>
        ) : null}
        {opp.source_run_id ? (
          <span className="subtle">
            surfaced by pipeline run{" "}
            <Link
              href={`/notifications?run=${opp.source_run_id}`}
              className="mono"
            >
              {opp.source_run_id}
            </Link>
          </span>
        ) : null}
      </div>
      {opp.match_rationale ? (
        <p
          className="subtle"
          style={{ marginTop: 8 }}
          data-testid="opp-rationale"
        >
          Opened because {opp.match_rationale}.
        </p>
      ) : null}

      <div className="split" style={{ marginTop: 26 }}>
        <div>
          <section className="card">
            <h3>Advance the deal</h3>
            <form action={advanceStageAction} style={{ marginTop: 12 }}>
              <input
                type="hidden"
                name="opportunity_id"
                value={opp.opportunity_id}
              />
              <div className="filters">
                <div>
                  <label htmlFor="to_stage">Move to stage</label>
                  <select
                    id="to_stage"
                    name="to_stage"
                    defaultValue={opp.stage}
                  >
                    {ALL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="changed_by">By</label>
                  <select
                    id="changed_by"
                    name="changed_by"
                    defaultValue={opp.assigned_to ?? ""}
                  >
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="stage_note">Why</label>
                  <input
                    id="stage_note"
                    name="note"
                    placeholder="Owner returned the call"
                  />
                </div>
                <div>
                  <button
                    className="btn"
                    type="submit"
                    data-testid="advance-stage"
                  >
                    Update stage
                  </button>
                </div>
              </div>
            </form>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <h3>Deal terms</h3>
            <form action={updateDealAction} style={{ marginTop: 12 }}>
              <input
                type="hidden"
                name="opportunity_id"
                value={opp.opportunity_id}
              />
              <div className="filters">
                <div>
                  <label htmlFor="owner_interest">Owner interest</label>
                  <select
                    id="owner_interest"
                    name="owner_interest"
                    defaultValue={opp.owner_interest ?? ""}
                  >
                    <option value="">Unknown</option>
                    <option value="interested">Interested</option>
                    <option value="maybe_later">Maybe later</option>
                    <option value="not_interested">Not interested</option>
                    <option value="no_response">No response</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="asking_price">Asking</label>
                  <input
                    id="asking_price"
                    name="asking_price"
                    type="number"
                    step="1000"
                    defaultValue={opp.asking_price ?? ""}
                  />
                </div>
                <div>
                  <label htmlFor="offer_price">Our offer</label>
                  <input
                    id="offer_price"
                    name="offer_price"
                    type="number"
                    step="1000"
                    defaultValue={opp.offer_price ?? ""}
                  />
                </div>
                <div>
                  <label htmlFor="assigned_to">Assigned to</label>
                  <select
                    id="assigned_to"
                    name="assigned_to"
                    defaultValue={opp.assigned_to ?? ""}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name} — {u.role}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="next_step">Next step</label>
                  <input
                    id="next_step"
                    name="next_step"
                    defaultValue={opp.next_step ?? ""}
                  />
                </div>
                <div>
                  <button
                    className="btn"
                    type="submit"
                    data-testid="update-deal"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
            <table style={{ marginTop: 14 }}>
              <tbody>
                <tr>
                  <td className="muted">Asking</td>
                  <td>{money(opp.asking_price)}</td>
                </tr>
                <tr>
                  <td className="muted">Our offer</td>
                  <td>{money(opp.offer_price)}</td>
                </tr>
                <tr>
                  <td className="muted">Owner interest</td>
                  <td>{opp.owner_interest ?? "—"}</td>
                </tr>
                <tr>
                  <td className="muted">Next step</td>
                  <td>{opp.next_step ?? "—"}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <h3>Owner outreach</h3>
            <p className="subtle" style={{ marginTop: 6 }}>
              Simulated. No message leaves this system — there is no provider
              configured and no credential that would allow one. The lifecycle
              below is modelled because the CRM has to reason about it.
            </p>

            <form action={draftOutreachAction} style={{ marginTop: 14 }}>
              <input
                type="hidden"
                name="opportunity_id"
                value={opp.opportunity_id}
              />
              <input
                type="hidden"
                name="owner_name"
                value={opp.owner_name ?? ""}
              />
              <input type="hidden" name="address" value={opp.address ?? ""} />
              <input
                type="hidden"
                name="rationale"
                value={opp.match_rationale ?? ""}
              />
              <div className="filters">
                <div>
                  <label htmlFor="channel">Channel</label>
                  <select id="channel" name="channel" defaultValue="email">
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="subject">Subject</label>
                  <input
                    id="subject"
                    name="subject"
                    defaultValue={draft.subject ?? ""}
                  />
                </div>
                <div>
                  <button
                    className="btn"
                    type="submit"
                    data-testid="draft-outreach"
                  >
                    Draft message
                  </button>
                </div>
              </div>
              <label htmlFor="body" style={{ display: "block", marginTop: 12 }}>
                <span className="subtle">
                  Body — edit before &ldquo;sending&rdquo;
                </span>
                <textarea
                  id="body"
                  name="body"
                  rows={7}
                  defaultValue={draft.body}
                  style={{
                    width: "100%",
                    marginTop: 6,
                    background: "var(--bg-sunken)",
                    color: "var(--fg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 10,
                    fontFamily: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
              </label>
            </form>

            {events.length ? (
              <div style={{ marginTop: 20 }} data-testid="outreach-list">
                {events.map(({ message: m, events: evs }) => {
                  const lifecycle = LIFECYCLE[m.channel] ?? [];
                  const idx = lifecycle.indexOf(m.status);
                  const next = lifecycle.slice(idx + 1);
                  return (
                    <div
                      key={m.outreach_id}
                      className="card"
                      style={{ marginTop: 12, background: "var(--bg-sunken)" }}
                    >
                      <div
                        className="row-actions"
                        style={{ justifyContent: "space-between" }}
                      >
                        <strong>
                          {CHANNEL_LABEL[m.channel]}
                          {m.subject ? ` — ${m.subject}` : ""}
                        </strong>
                        <span
                          className="badge badge-info"
                          data-testid="outreach-status"
                        >
                          {m.status}
                        </span>
                      </div>
                      <pre
                        className="mono subtle"
                        style={{
                          marginTop: 10,
                          whiteSpace: "pre-wrap",
                          fontSize: "0.8rem",
                        }}
                      >
                        {m.body}
                      </pre>
                      <ul className="timeline">
                        {evs.map((e, i) => (
                          <li key={`${e.status}-${i}`}>
                            <strong>{e.status}</strong>{" "}
                            <span className="subtle">
                              {when(e.occurred_at)}
                            </span>
                            <div className="subtle">{e.detail}</div>
                          </li>
                        ))}
                      </ul>
                      {next.length ? (
                        <form
                          action={advanceOutreachAction}
                          className="row-actions"
                        >
                          <input
                            type="hidden"
                            name="outreach_id"
                            value={m.outreach_id}
                          />
                          <input
                            type="hidden"
                            name="opportunity_id"
                            value={opp.opportunity_id}
                          />
                          <select
                            name="to_status"
                            defaultValue={next[0]}
                            aria-label="Next state"
                          >
                            {next.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn btn-secondary"
                            type="submit"
                            data-testid="advance-outreach"
                          >
                            Simulate next state
                          </button>
                        </form>
                      ) : (
                        <p className="subtle">
                          This message has reached a terminal state.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>

        <div>
          <section className="card">
            <h3>Stage history</h3>
            <ul className="timeline" data-testid="stage-history">
              {history.map((h, i) => (
                <li key={i}>
                  <strong>
                    {h.from_stage ? `${h.from_stage} → ` : ""}
                    {h.to_stage}
                  </strong>
                  <div className="subtle">
                    {when(h.changed_at)}
                    {h.changed_by ? ` · ${h.changed_by}` : ""}
                  </div>
                  {h.note ? <div className="muted">{h.note}</div> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <h3>Tasks</h3>
            <form action={addTaskAction} style={{ marginTop: 12 }}>
              <input
                type="hidden"
                name="opportunity_id"
                value={opp.opportunity_id}
              />
              <div className="filters">
                <div>
                  <label htmlFor="title">Task</label>
                  <input
                    id="title"
                    name="title"
                    placeholder="Skip-trace the owner"
                  />
                </div>
                <div>
                  <label htmlFor="task_assignee">Assign to</label>
                  <select id="task_assignee" name="assigned_to" defaultValue="">
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.user_id} value={u.user_id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="due_on">Due</label>
                  <input id="due_on" name="due_on" type="date" />
                </div>
                <div>
                  <button className="btn" type="submit" data-testid="add-task">
                    Add
                  </button>
                </div>
              </div>
            </form>
            <table style={{ marginTop: 12 }} data-testid="tasks">
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.task_id}>
                    <td>
                      <span
                        style={{
                          textDecoration: t.done ? "line-through" : "none",
                        }}
                      >
                        {t.title}
                      </span>
                      <div className="subtle">
                        {t.assigned_to ?? "unassigned"}
                        {t.due_on ? ` · due ${t.due_on}` : ""}
                      </div>
                    </td>
                    <td>
                      <form action={toggleTaskAction}>
                        <input type="hidden" name="task_id" value={t.task_id} />
                        <input
                          type="hidden"
                          name="opportunity_id"
                          value={opp.opportunity_id}
                        />
                        <button className="btn btn-secondary" type="submit">
                          {t.done ? "Reopen" : "Done"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
                {tasks.length === 0 ? (
                  <tr>
                    <td className="muted">No tasks yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>

          <section className="card" style={{ marginTop: 18 }}>
            <h3>Notes</h3>
            <form action={addNoteAction} style={{ marginTop: 12 }}>
              <input
                type="hidden"
                name="opportunity_id"
                value={opp.opportunity_id}
              />
              <textarea
                name="body"
                rows={3}
                placeholder="Owner said they inherited it in 2011 and have never lived there."
                aria-label="Note"
                style={{
                  width: "100%",
                  background: "var(--bg-sunken)",
                  color: "var(--fg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 10,
                  fontFamily: "inherit",
                  fontSize: "0.9rem",
                }}
              />
              <div className="row-actions" style={{ marginTop: 8 }}>
                <select
                  name="author_id"
                  defaultValue="u-dana"
                  aria-label="Author"
                >
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.name}
                    </option>
                  ))}
                </select>
                <button className="btn" type="submit" data-testid="add-note">
                  Add note
                </button>
              </div>
            </form>
            <ul
              className="timeline"
              style={{ marginTop: 14 }}
              data-testid="notes"
            >
              {notes.map((nte) => (
                <li key={nte.note_id}>
                  <div>{nte.body}</div>
                  <div className="subtle">
                    {nte.author_id ?? "unknown"} · {when(nte.created_at)}
                  </div>
                </li>
              ))}
              {notes.length === 0 ? (
                <li className="muted">No notes yet.</li>
              ) : null}
            </ul>
          </section>
        </div>
      </div>

      <p className="subtle" style={{ marginTop: 26 }}>
        Created {when(opp.created_at)} · last updated {when(opp.updated_at)} ·{" "}
        {num(messages.length)} outreach{" "}
        {messages.length === 1 ? "message" : "messages"}
      </p>
    </>
  );
}
