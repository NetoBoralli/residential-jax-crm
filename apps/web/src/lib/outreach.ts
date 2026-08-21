import "server-only";

import { all, lit, nextId, one, run } from "./db";

/**
 * Mocked owner outreach.
 *
 * Nothing is sent. No provider is configured, no address is contacted, and the
 * app has no credentials that would let it. What is modelled is the lifecycle,
 * because that is the part the CRM has to reason about: a deal whose letter
 * bounced needs different handling from one whose email is sitting unread.
 *
 * Every rendered message is labelled as a simulation in the UI, and the
 * transitions below are driven by an explicit user action rather than a timer —
 * a background job flipping messages to "delivered" on a schedule would look
 * like evidence of delivery, which is exactly the thing that is not happening.
 */

export const CHANNELS = ["email", "sms", "direct_mail"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  sms: "SMS",
  direct_mail: "Direct mail",
};

/**
 * Which lifecycle states each channel can reach.
 *
 * They differ for real reasons and flattening them would be a lie: a posted
 * letter has no delivery receipt and cannot bounce back the same day, and an
 * SMS has no subject line or open event.
 */
export const LIFECYCLE: Record<Channel, string[]> = {
  email: ["queued", "sent", "delivered", "opened", "replied", "bounced"],
  sms: ["queued", "sent", "delivered", "replied", "failed"],
  direct_mail: ["queued", "printed", "mailed", "in_transit", "returned"],
};

export interface Outreach {
  outreach_id: string;
  opportunity_id: string;
  channel: Channel;
  subject: string | null;
  body: string;
  status: string;
  to_address: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachEvent {
  outreach_id: string;
  status: string;
  detail: string | null;
  occurred_at: string;
}

export async function draftOutreach(input: {
  opportunityId: string;
  channel: Channel;
  subject?: string;
  body: string;
  toAddress?: string;
}): Promise<string> {
  const id = await nextId("msg");
  await run(`
    INSERT INTO outreach (outreach_id, opportunity_id, channel, subject, body, status, to_address)
    VALUES (${lit(id)}, ${lit(input.opportunityId)}, ${lit(input.channel)},
            ${lit(input.subject ?? null)}, ${lit(input.body)}, 'queued', ${lit(input.toAddress ?? null)})
  `);
  await recordEvent(id, "queued", "Drafted in the CRM. Nothing has been sent.");
  return id;
}

async function recordEvent(
  outreachId: string,
  status: string,
  detail: string,
): Promise<void> {
  await run(`
    INSERT INTO outreach_events (outreach_id, status, detail)
    VALUES (${lit(outreachId)}, ${lit(status)}, ${lit(detail)})
  `);
}

/**
 * Advance a message to the next state its channel allows.
 *
 * Rejecting an out-of-order transition matters: without it the UI could record
 * a letter as "returned" before it was ever "mailed", and the audit trail
 * would be useless for exactly the deals someone later asks questions about.
 */
export async function advanceOutreach(
  outreachId: string,
  toStatus: string,
): Promise<void> {
  const msg = await one<Outreach>(
    `SELECT * FROM outreach WHERE outreach_id = ${lit(outreachId)}`,
  );
  if (!msg) throw new Error(`No outreach ${outreachId}`);

  const label = CHANNEL_LABEL[msg.channel] ?? msg.channel;
  const lifecycle = LIFECYCLE[msg.channel] ?? [];
  if (lifecycle.length === 0) {
    throw new Error(
      `"${msg.channel}" is not a channel with a known lifecycle.`,
    );
  }

  const from = lifecycle.indexOf(msg.status);
  const to = lifecycle.indexOf(toStatus);
  if (to < 0) {
    throw new Error(
      `"${toStatus}" is not a state a ${label} message can reach.`,
    );
  }
  // A status outside its own lifecycle gives from = -1, which would make every
  // forward comparison true and let the message be rewound to "queued".
  if (from < 0) {
    throw new Error(
      `This ${label} message is in state "${msg.status}", which is not part of its lifecycle; it cannot be advanced.`,
    );
  }
  if (to <= from) {
    throw new Error(
      `A ${label} message cannot go from "${msg.status}" back to "${toStatus}".`,
    );
  }

  await run(`
    UPDATE outreach SET status = ${lit(toStatus)}, updated_at = now()
     WHERE outreach_id = ${lit(outreachId)}
  `);
  await recordEvent(
    outreachId,
    toStatus,
    "Simulated transition — no message left this system.",
  );
}

export async function listOutreach(opportunityId: string): Promise<Outreach[]> {
  return all<Outreach>(`
    SELECT * FROM outreach WHERE opportunity_id = ${lit(opportunityId)}
     ORDER BY created_at DESC
  `);
}

export async function outreachEvents(
  outreachId: string,
): Promise<OutreachEvent[]> {
  return all<OutreachEvent>(`
    SELECT * FROM outreach_events WHERE outreach_id = ${lit(outreachId)}
     ORDER BY occurred_at ASC
  `);
}

/**
 * A starting draft for each channel.
 *
 * Written to be defensible if it were ever actually sent: it says where the
 * information came from, makes no claim about the property's condition that
 * the pipeline cannot support, and does not imply a valuation.
 */
export function template(input: {
  channel: Channel;
  ownerName: string | null;
  address: string | null;
  rationale?: string | null;
}): { subject?: string; body: string } {
  const owner = input.ownerName?.trim() || "Property owner";
  const address = input.address?.trim() || "your Duval County property";
  const why = input.rationale
    ? ` Our records flagged it because ${input.rationale.toLowerCase()}.`
    : "";

  if (input.channel === "sms") {
    return {
      body:
        `Hi — this is Dana with a Jacksonville acquisitions group. We're interested in ${address} ` +
        `and wondered whether you'd consider an offer. Reply STOP to opt out.`,
    };
  }
  if (input.channel === "direct_mail") {
    return {
      subject: `Regarding ${address}`,
      body:
        `${owner}\n${address}\n\n` +
        `Dear ${owner},\n\n` +
        `We are a Jacksonville-based residential acquisitions group and we are interested in ` +
        `${address}.${why}\n\n` +
        `If you would consider an offer, or simply want to know what the property might be worth, ` +
        `we would welcome a short conversation. There is no obligation.\n\n` +
        `Ownership and assessment details came from Duval County public records via the Florida ` +
        `Department of Revenue tax roll. If you would prefer not to hear from us again, let us know ` +
        `and we will remove this address.\n\n` +
        `Sincerely,\nDana Whitfield\nAcquisitions`,
    };
  }
  return {
    subject: `Interested in ${address}`,
    body:
      `Hello ${owner},\n\n` +
      `I lead acquisitions for a Jacksonville residential group. We are interested in ` +
      `${address} and wanted to ask directly whether you would consider selling.${why}\n\n` +
      `Happy to share how we arrived at a number, and equally happy to hear it is not for sale.\n\n` +
      `Ownership details came from Duval County public records. Reply here and I will take the ` +
      `address off our list if you would rather not be contacted.\n\n` +
      `Best,\nDana Whitfield`,
  };
}
