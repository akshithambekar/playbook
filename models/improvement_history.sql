select
  il.id,
  il.created_at,
  il.calls_analyzed,
  il.analysis_summary,
  old_p.version as old_version,
  new_p.version as new_version,
  old_p.strategy as old_strategy,
  new_p.strategy as new_strategy,
  new_p.rationale
from {{ source('public', 'improvement_logs') }} il
left join {{ source('public', 'playbooks') }} old_p
  on il.old_playbook_id = old_p.id
left join {{ source('public', 'playbooks') }} new_p
  on il.new_playbook_id = new_p.id
