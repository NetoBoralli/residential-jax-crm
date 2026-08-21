-- CRM state.
--
-- This is workspace state — saved criteria, opportunities, outreach, notes —
-- and nothing else. Not one column of Duval County property data is stored
-- here: property facts are read from the Oracle pipeline on demand and are
-- referenced only by folio (`request_identifier`). That is what keeps the two
-- systems from disagreeing, and it is why the CRM does not need a copy of a
-- 404,023-row dataset to be useful.
--
-- It runs on a DuckDB file on the container's volume rather than a hosted
-- database, which the assignment asks for explicitly: no ongoing hosted
-- database cost beyond the existing pipeline + DuckDB / Elephant IPFS pattern.
-- At this scale — a team's saved searches and deal pipeline — that is not a
-- compromise; a Postgres instance would be idle infrastructure billed by the
-- month.

CREATE SEQUENCE IF NOT EXISTS seq_id START 1;

CREATE TABLE IF NOT EXISTS users (
    user_id     TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A named criteria set. `where_sql` is a boolean expression over the Oracle's
-- `properties` view; the Oracle validates it against its own parse tree before
-- running it, so the CRM never builds SQL the Oracle has not vetted.
CREATE TABLE IF NOT EXISTS saved_searches (
    search_id     TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    where_sql     TEXT NOT NULL,
    criteria_json JSON NOT NULL,
    owner_id      TEXT NOT NULL,
    notify        BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_checked_run_id TEXT,
    last_checked_at     TIMESTAMPTZ
);

-- One row per (saved search, pipeline run) that produced matches. The run id
-- and the changes artifact CID are stored so an alert can always be traced
-- back to the immutable evidence that triggered it.
CREATE TABLE IF NOT EXISTS notifications (
    notification_id TEXT PRIMARY KEY,
    search_id       TEXT NOT NULL,
    run_id          TEXT NOT NULL,
    changes_cid     TEXT,
    matched_count   INTEGER NOT NULL,
    -- How many matched rows were captured as evidence. The Oracle caps what it
    -- returns, so this is normally smaller than matched_count, and the UI has
    -- to be able to say so rather than implying it listed everything.
    captured_matches INTEGER,
    changed_in_run  INTEGER NOT NULL,
    delta_types     TEXT NOT NULL,
    channel         TEXT NOT NULL DEFAULT 'in_app',
    read_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (search_id, run_id)
);

-- The specific properties that caused a notification, captured at alert time.
-- These are a snapshot for the audit trail, not a cache to read from: every
-- live view re-reads the property from the Oracle.
CREATE TABLE IF NOT EXISTS notification_matches (
    notification_id TEXT NOT NULL,
    folio           TEXT NOT NULL,
    delta_type      TEXT NOT NULL,
    address         TEXT,
    owner_name      TEXT,
    market_value    DOUBLE,
    PRIMARY KEY (notification_id, folio)
);

CREATE TABLE IF NOT EXISTS opportunities (
    opportunity_id  TEXT PRIMARY KEY,
    folio           TEXT NOT NULL,
    address         TEXT,
    owner_name      TEXT,
    stage           TEXT NOT NULL DEFAULT 'Identified',
    match_score     INTEGER,
    match_rationale TEXT,
    source_search_id TEXT,
    source_run_id    TEXT,
    owner_interest  TEXT,
    asking_price    DOUBLE,
    offer_price     DOUBLE,
    assigned_to     TEXT,
    next_step       TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (folio)
);

CREATE TABLE IF NOT EXISTS stage_history (
    opportunity_id TEXT NOT NULL,
    from_stage     TEXT,
    to_stage       TEXT NOT NULL,
    changed_by     TEXT,
    note           TEXT,
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outreach is mocked end to end: nothing is sent. The lifecycle is modelled
-- honestly anyway — queued → sent → delivered → replied/bounced — because the
-- states are what the CRM has to reason about, and a fake "sent" with no
-- delivery model would be the part that misleads.
CREATE TABLE IF NOT EXISTS outreach (
    outreach_id    TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    channel        TEXT NOT NULL,
    subject        TEXT,
    body           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'queued',
    to_address     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS outreach_events (
    outreach_id TEXT NOT NULL,
    status      TEXT NOT NULL,
    detail      TEXT,
    -- Not `at`: DuckDB reserves it for AT TIME ZONE, and the CREATE fails to
    -- parse, which takes the whole schema with it.
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
    note_id        TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    author_id      TEXT,
    body           TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    task_id        TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL,
    title          TEXT NOT NULL,
    assigned_to    TEXT,
    due_on         DATE,
    done           BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
