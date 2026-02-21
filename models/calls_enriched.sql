select
  c.id,
  c.created_at,
  c.outcome,
  c.main_objection,
  c.interest_level,
  p.version        as playbook_version,
  p.strategy,
  p.tone,
  p.opener,
  p.objection_style,
  p.close_technique,
  ca.engagement_score,
  ca.engagement_trend,
  ca.agent_tone
from {{ source('public', 'calls') }} c
left join {{ source('public', 'playbooks') }} p
  on c.playbook_id = p.id
left join {{ source('public', 'call_analysis') }} ca
  on ca.call_id = c.id
