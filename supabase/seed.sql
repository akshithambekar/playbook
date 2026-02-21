-- ============================================================
-- Run AFTER schema.sql to seed the v1 playbook
-- ============================================================

insert into playbooks (version, strategy, opener, objection_style, tone, close_technique, rationale)
values (
  1,

  'Lead with curiosity and problem discovery. Avoid pitching features upfront. Understand the prospect''s pain, confirm they own the problem, then position the product as the natural solution.',

  'Hey [Name], I''ll keep this quick — I noticed [relevant trigger]. Most folks I talk to in [role] are dealing with [pain point]. Is that something that''s been on your radar lately?',

  'When objections come up, acknowledge before responding. For price objections: anchor to cost of inaction. For timing objections: ask what would need to change for this to be the right time. For competitor objections: focus on the specific outcome we deliver better.',

  'Conversational and direct. No corporate buzzwords. Match the prospect''s energy — if they''re brief, be brief. Sound like a peer, not a vendor.',

  'Soft close first: "Does this seem like it could solve [pain point] for you?" If yes, move to calendar: "I''d love to show you exactly how — are you free [day] or [day] this week?" Never ask open-ended scheduling questions.',

  'Version 1 — handcrafted baseline playbook. Uses classic consultative selling structure: hook with pain, confirm fit, handle objections with empathy, close with a concrete next step. No data yet; this is the starting hypothesis.'
);
