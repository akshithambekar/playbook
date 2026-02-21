-- ============================================================
-- Run this once in the Supabase SQL Editor to set up all tables
-- ============================================================

-- Versioned sales playbooks written by Airia
create table if not exists playbooks (
  id               uuid primary key default gen_random_uuid(),
  version          integer not null unique,
  strategy         text not null,
  opener           text not null,
  objection_style  text not null,
  tone             text not null,
  close_technique  text not null,
  rationale        text not null,
  created_at       timestamptz not null default now()
);

-- Every ElevenLabs conversation
create table if not exists calls (
  id                           uuid primary key default gen_random_uuid(),
  elevenlabs_conversation_id   text not null unique,
  transcript                   text,
  outcome                      text check (outcome in ('converted', 'no_close', 'callback', 'hung_up')),
  main_objection               text,
  interest_level               text,
  playbook_id                  uuid references playbooks(id),
  created_at                   timestamptz not null default now()
);

-- Modulate Velma voice analysis results per call
create table if not exists call_analysis (
  id                  uuid primary key default gen_random_uuid(),
  call_id             uuid not null unique references calls(id) on delete cascade,
  engagement_score    numeric(4, 3),               -- 0.000 – 1.000
  engagement_trend    text,                         -- e.g. 'rising', 'falling', 'flat'
  prospect_emotions   jsonb,                        -- emotion trajectory array
  agent_tone          text,
  deception_flags     jsonb,                        -- array of flag objects
  key_moments         jsonb,                        -- notable moments with timestamps
  created_at          timestamptz not null default now()
);

-- Tracks every time Airia rewrote the playbook
create table if not exists improvement_logs (
  id               uuid primary key default gen_random_uuid(),
  calls_analyzed   integer not null,
  old_playbook_id  uuid references playbooks(id),
  new_playbook_id  uuid references playbooks(id),
  analysis_summary text,
  created_at       timestamptz not null default now()
);

-- Indexes for common query patterns
create index if not exists calls_playbook_id_idx       on calls(playbook_id);
create index if not exists calls_created_at_idx        on calls(created_at);
create index if not exists call_analysis_call_id_idx   on call_analysis(call_id);
create index if not exists improvement_logs_created_at on improvement_logs(created_at desc);
