import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "app.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS playbooks (
    id               TEXT PRIMARY KEY,
    version          INTEGER NOT NULL UNIQUE,
    strategy         TEXT NOT NULL,
    opener           TEXT NOT NULL,
    objection_style  TEXT NOT NULL,
    tone             TEXT NOT NULL,
    close_technique  TEXT NOT NULL,
    rationale        TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS calls (
    id                           TEXT PRIMARY KEY,
    elevenlabs_conversation_id   TEXT NOT NULL UNIQUE,
    transcript                   TEXT,
    outcome                      TEXT CHECK (outcome IN ('converted', 'no_close', 'callback', 'hung_up')),
    main_objection               TEXT,
    interest_level               TEXT,
    playbook_id                  TEXT REFERENCES playbooks(id),
    created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS call_analysis (
    id                TEXT PRIMARY KEY,
    call_id           TEXT NOT NULL UNIQUE REFERENCES calls(id) ON DELETE CASCADE,
    engagement_score  REAL,
    engagement_trend  TEXT,
    prospect_emotions TEXT,
    agent_tone        TEXT,
    deception_flags   TEXT,
    key_moments       TEXT,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS improvement_logs (
    id               TEXT PRIMARY KEY,
    calls_analyzed   INTEGER NOT NULL,
    old_playbook_id  TEXT REFERENCES playbooks(id),
    new_playbook_id  TEXT REFERENCES playbooks(id),
    analysis_summary TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS calls_playbook_id_idx     ON calls(playbook_id);
  CREATE INDEX IF NOT EXISTS calls_created_at_idx      ON calls(created_at);
  CREATE INDEX IF NOT EXISTS call_analysis_call_id_idx ON call_analysis(call_id);
  CREATE INDEX IF NOT EXISTS improvement_logs_created_at ON improvement_logs(created_at DESC);
`);

// Seed the v1 playbook if the table is empty
const existing = db.prepare("SELECT COUNT(*) as count FROM playbooks").get() as { count: number };
if (existing.count === 0) {
  db.prepare(`
    INSERT INTO playbooks (id, version, strategy, opener, objection_style, tone, close_technique, rationale, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    "Lead with curiosity and problem discovery. Avoid pitching features upfront. Understand the prospect's pain, confirm they own the problem, then position the product as the natural solution.",
    "Hey [Name], I'll keep this quick — I noticed [relevant trigger]. Most folks I talk to in [role] are dealing with [pain point]. Is that something that's been on your radar lately?",
    "When objections come up, acknowledge before responding. For price objections: anchor to cost of inaction. For timing objections: ask what would need to change for this to be the right time. For competitor objections: focus on the specific outcome we deliver better.",
    "Conversational and direct. No corporate buzzwords. Match the prospect's energy — if they're brief, be brief. Sound like a peer, not a vendor.",
    "Soft close first: \"Does this seem like it could solve [pain point] for you?\" If yes, move to calendar: \"I'd love to show you exactly how — are you free [day] or [day] this week?\" Never ask open-ended scheduling questions.",
    "Version 1 — handcrafted baseline playbook. Uses classic consultative selling structure: hook with pain, confirm fit, handle objections with empathy, close with a concrete next step. No data yet; this is the starting hypothesis.",
    new Date().toISOString()
  );
}

export default db;
