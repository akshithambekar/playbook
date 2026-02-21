# Project Requirements Document

## Self-Improving Voice Sales Agent

An autonomous voice sales agent built on ElevenLabs Conversational AI that conducts sales conversations, analyzes its own performance via Modulate Velma, tracks metrics in Lightdash, and uses Airia to autonomously rewrite its own sales playbook — getting better at closing with every conversation.

---

## Hackathon Fit

| Criteria (20% each)          | How We Score                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idea**                     | Voice sales is a massive market. A self-improving agent that rewrites its own playbook based on emotional/behavioral signals is compelling and demo-able.        |
| **Technical Implementation** | Full pipeline: voice agent → voice intelligence → analytics DB → autonomous strategy rewriter → next conversation.                                               |
| **Tool Use (3 sponsors)**    | **Modulate Velma** (voice emotion/engagement analysis), **Airia** (orchestration + self-improvement pipeline), **Lightdash** (BI dashboard proving improvement). |
| **Presentation**             | Live demo: conduct 2-3 conversations, show the agent adapting its pitch between them. Dashboard shows metrics shifting.                                          |
| **Autonomy**                 | Zero human intervention. Agent converses, analyzes, learns, and adjusts strategy on its own using real-time data.                                                |

---

## End-to-End Flow

1. **Initiate Conversation** — Next.js app fetches latest playbook from Supabase, opens ElevenLabs widget with playbook fields injected as dynamic variables
2. **Conduct Conversation** — ElevenLabs handles the full interaction (STT + LLM + TTS + turn-taking). The playbook IS the system prompt.
3. **Conversation Ends → Webhooks Fire** — ElevenLabs sends post-call transcript + audio to our Next.js API routes (exposed via ngrok)
4. **Analyze with Modulate Velma** — API route sends the audio to Velma, gets back emotion trajectory, engagement score, tone, deception flags. Stores everything in Supabase.
5. **Check if Improvement Needed** — If calls since last improvement >= BATCH_SIZE (e.g. 3): trigger Airia
6. **Airia Rewrites the Playbook** — Airia pipeline fetches call data from our API (via ngrok), LLM analyzes patterns, second LLM generates improved playbook, saves to DB
7. **Next Conversation Uses New Playbook** — Dynamic variables pull the updated playbook. Agent is now better.
8. **Lightdash Shows Improvement** — Dashboard auto-refreshes. Conversion rate, engagement scores, strategy changelog all visible.

---

## Components

### ElevenLabs Conversational AI (Voice Agent)

The entire voice agent — STT, LLM, TTS, turn-taking — in one platform. Conversations happen through a web widget embedded in our Next.js app.

- **Dynamic variables** inject playbook fields (`{{playbook_strategy}}`, `{{opener}}`, `{{tone}}`, etc.) into the system prompt per conversation
- **Post-call webhooks** fire when conversation ends — deliver transcript, structured data collection, and audio to our API routes
- **Data collection** extracts structured fields we define: outcome, main objection, interest level
- **Eleven v3 voice** with expressive emotional delivery

### Modulate Velma (Voice Intelligence)

Analyzes HOW the conversation went — the emotional and behavioral layer that transcripts miss.

- **Emotion trajectory** — curiosity → interest → frustration. Where in the pitch do we lose people?
- **Engagement score** (0-1) — the single metric we optimize against
- **Agent tone analysis** — was the playbook's tone instruction actually followed?
- **Deception/politeness flags** — prospect sounds polite but is actually disengaged
- **Pause/hesitation analysis** — long pauses after pricing = price sensitivity

We will get API access from Modulate's team at the event.

### Airia (Self-Improvement Pipeline)

A 6-node pipeline in Agent Studio (low-code canvas) that is the autonomous brain:

1. **Trigger** — webhook from our Next.js backend
2. **API Call** — fetches recent call data + voice analysis from our API
3. **LLM Analysis** — identifies what worked, what failed, emotion insights
4. **LLM Generation** — writes improved playbook (strategy, opener, objection style, tone, close technique, rationale)
5. **Formatter** — validates JSON schema
6. **API Call** — saves new playbook to our Supabase DB

### Lightdash (Analytics Dashboard)

Connected to Supabase. Proves the agent is actually improving.

- **Conversion rate by playbook version** — the hero chart, should trend up
- **Engagement score by strategy** — which playbooks produce better emotional responses
- **Strategy changelog** — version, timestamp, rationale, key changes
- **Conversation feed** — recent conversations with outcome badges

---

## Tech Stack

| Component          | Technology                                                            |
| ------------------ | --------------------------------------------------------------------- |
| Voice Agent        | ElevenLabs Conversational AI (web widget)                             |
| Voice Intelligence | Modulate Velma API                                                    |
| Orchestration      | Airia Agent Studio + REST API                                         |
| Analytics          | Lightdash Cloud                                                       |
| Database           | Supabase (hosted Postgres, free tier)                                 |
| App                | Next.js (frontend + API routes), runs locally                         |
| Tunnel             | ngrok (exposes local API routes for webhooks from ElevenLabs + Airia) |

Everything is TypeScript. One repo, runs locally, ngrok exposes it. Supabase gives us a hosted Postgres with a connection string that both our local app and Lightdash Cloud can connect to — no tunneling the DB.

---

## Database (Supabase — hosted Postgres)

Free tier, instant setup. One connection string used by both the local Next.js app and Lightdash Cloud.

Four tables:

- **playbooks** — versioned strategies written by Airia (strategy, opener, objection_style, tone, close_technique, rationale)
- **calls** — every conversation with ElevenLabs conversation_id, transcript, outcome, main objection, playbook_id
- **call_analysis** — voice analysis results per call (engagement_score, engagement_trend, prospect_emotions, agent_tone, deception_flags, key_moments)
- **improvement_logs** — tracks when and why Airia changed the playbook (calls_analyzed, old_playbook_id, new_playbook_id, analysis_summary)

---

## Team Setup (11:00–11:15, together)

- Agree on DB schema, API route contracts, playbook JSON shape
- Both create accounts (ElevenLabs, Modulate, Airia, Lightdash)
- Init Next.js repo, push to GitHub, both clone
- One person creates Supabase project, shares connection string
- Start ngrok, share the tunnel URL

---

## Person 1: App + Velma + Lightdash

| #   | Task                            | Details                                                                                                 | Done when                                    |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 1   | Init Next.js project            | App Router, install Prisma/Drizzle, connect to Supabase via connection string                           | Project runs locally, queries work           |
| 2   | DB schema + seed                | Create 4 tables, seed with handwritten v1 playbook                                                      | Can query playbooks table                    |
| 3   | `GET /api/playbooks/latest`     | Returns current playbook JSON                                                                           | Person 2's frontend can fetch it             |
| 4   | `POST /api/playbooks`           | Saves new playbook from Airia, auto-increments version                                                  | curl POST creates a new row                  |
| 5   | `POST /api/webhooks/transcript` | Receives ElevenLabs post-call transcript webhook, parses data collection fields, saves to `calls` table | Webhook payload saves correctly              |
| 6   | `POST /api/webhooks/audio`      | Receives ElevenLabs post-call audio webhook, decodes audio, calls Velma, saves to `call_analysis`       | Audio → Velma → DB works                     |
| 7   | `GET /api/calls/recent`         | Returns calls + analysis since last improvement for Airia                                               | JSON response matches Airia's expected input |
| 8   | `POST /api/trigger-improvement` | Counts calls since last improvement, if >= threshold triggers Airia webhook                             | Airia pipeline gets triggered                |
| 9   | Talk to Modulate team           | Get API credentials, endpoint, understand request/response format                                       | Have working API key + know the contract     |
| 10  | Build Velma integration         | `analyzeCall` function: takes audio buffer → calls Velma API → returns call_analysis schema             | Sample audio → structured analysis JSON      |
| 11  | Handle audio format conversion  | ElevenLabs sends base64, Velma may need WAV/MP3 — handle the conversion                                 | End-to-end audio pipeline works              |
| 12  | Test Velma with samples         | Record 2-3 sample conversations, run through Velma, verify output is meaningful                         | Confident in data quality                    |
| 13  | Set up Lightdash                | Lightdash Cloud trial, connect to Supabase using the same connection string                             | Lightdash can see tables                     |
| 14  | Build dashboard panels          | Conversion rate by version, engagement by strategy, strategy changelog, conversation feed               | 4 panels rendering with seeded data          |
| 15  | Start ngrok                     | Expose local Next.js on a public URL, share with Person 2 for webhook config                            | Stable tunnel URL available                  |

---

## Person 2: ElevenLabs + Airia + Frontend

| #   | Task                         | Details                                                                                                                                                               | Done when                                            |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | Create ElevenLabs agent      | New agent in dashboard, select Eleven v3 voice                                                                                                                        | Agent exists and can talk                            |
| 2   | Write system prompt          | Use dynamic variable placeholders: `{{playbook_strategy}}`, `{{opener}}`, `{{objection_style}}`, `{{tone}}`, `{{close_technique}}`                                    | Prompt saved in agent config                         |
| 3   | Configure data collection    | Define extraction fields: outcome (converted/no_close/callback/hung_up), main_objection, interest_level                                                               | Fields visible in agent settings                     |
| 4   | Configure post-call webhooks | Point transcript webhook → `{ngrok}/api/webhooks/transcript`, audio webhook → `{ngrok}/api/webhooks/audio`                                                            | Webhooks saved in ElevenLabs                         |
| 5   | Test agent in dashboard      | Have a test conversation directly in ElevenLabs, verify it works and data collection extracts correctly                                                               | Agent converses naturally, fields populate           |
| 6   | Create Airia project         | Sign up, create project, add GPT-4o to model library                                                                                                                  | Project ready                                        |
| 7   | Build Airia node 1-2         | Webhook trigger node + API call node → `GET {ngrok}/api/calls/recent`                                                                                                 | Trigger fires and data fetches                       |
| 8   | Build Airia node 3           | LLM analysis node — prompt that identifies what worked/failed from emotion data, engagement scores, outcomes, deception flags                                         | Returns structured analysis JSON                     |
| 9   | Build Airia node 4           | LLM generation node — prompt that outputs playbook JSON (strategy, opener, objection_style, tone, close_technique, rationale). Changes must be justified by analysis. | Returns valid playbook JSON                          |
| 10  | Build Airia nodes 5-6        | Formatter node (validate JSON) + API call node → `POST {ngrok}/api/playbooks`                                                                                         | Pipeline saves playbook to DB                        |
| 11  | Iterate on LLM prompts       | Test with varied mock data: all successes, all failures, mixed, sparse emotion data. Prompts should produce meaningfully different playbooks.                         | Pipeline outputs sensible, differentiated strategies |
| 12  | Test full pipeline           | Run end-to-end in Airia with realistic sample payloads, verify new playbook appears in DB                                                                             | Full pipeline works standalone                       |
| 13  | Build frontend page          | Next.js page at `/`: fetch latest playbook, embed ElevenLabs widget with dynamic variables, show playbook version + strategy + conversation count                     | Page loads, widget connects, playbook displays       |
| 14  | Self-improvement status UI   | Show calls until next improvement cycle, latest playbook rationale, version history                                                                                   | Visible on the page                                  |

---

## Timeline (5 hours: 11:00am–4:30pm)

### Phase 1: Parallel Build (11:00–1:30, 2.5 hrs)

| Time        | Person 1 (App + Velma + Lightdash)                                                                 | Person 2 (ElevenLabs + Airia + Frontend)                             |
| ----------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 11:00–11:15 | **Together:** agree on contracts, init repo, create Supabase project, create accounts, start ngrok |                                                                      |
| 11:15–11:45 | Tasks 1-4: Next.js init, DB schema + seed, playbook routes                                         | Tasks 1-5: ElevenLabs agent, prompt, data collection, webhooks, test |
| 11:45–12:15 | Tasks 5-8: Webhook handlers, recent calls endpoint, improvement trigger                            | Tasks 6-10: Airia project, all 6 pipeline nodes                      |
| 12:15–1:00  | Tasks 9-12: Talk to Modulate, build Velma integration, test with samples                           | Tasks 11-12: Iterate on Airia LLM prompts, test with mock data       |
| 1:00–1:30   | Tasks 13-14: Lightdash setup + dashboard panels                                                    | Tasks 13-14: Frontend page with widget + status UI                   |

### Phase 2: Integration (1:30–2:45, 1.25 hrs)

| Time      | What happens                                                                                                                                   |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1:30–2:00 | **ElevenLabs → App:** Run a conversation through the widget. Verify transcript + audio webhooks hit local API routes. Verify data lands in DB. |
| 2:00–2:30 | **App → Velma → DB:** Verify audio webhook triggers Velma analysis. Verify results in `call_analysis`. Verify Lightdash shows new data.        |
| 2:30–2:45 | **App → Airia → DB:** Hit improvement trigger. Verify Airia pipeline runs. Verify new playbook saves. Verify frontend loads updated playbook.  |

### Phase 3: Full Loop + Demo (2:45–4:30, 1.75 hrs)

| Time      | What happens                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2:45–3:30 | Run the **complete loop** 3+ times. Conversation → Velma → Airia rewrite → new playbook → next conversation. Fix bugs. |
| 3:30–4:00 | Capture demo materials: Lightdash screenshots, Airia logs, playbook diffs. Rehearse 3-min demo. Assign speaking roles. |
| 4:00–4:30 | Final polish, submit to Devpost.                                                                                       |
