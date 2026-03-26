const { getDb } = require('../db');

function show(id) {
  const db = getDb();
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);

  if (!opp) {
    console.error(`Opportunity #${id} not found.`);
    process.exit(1);
  }

  const emails = db.prepare(
    'SELECT id, from_address, from_name, subject, received_at FROM emails WHERE opportunity_id = ? ORDER BY received_at DESC'
  ).all(id);

  const history = db.prepare(
    'SELECT old_status, new_status, note, changed_at FROM status_history WHERE opportunity_id = ? ORDER BY changed_at DESC'
  ).all(id);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`#${opp.id}  ${opp.company_name} — ${opp.project_title || ''}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const pay = opp.compensation_min && opp.compensation_max
    ? `${opp.compensation_min}-${opp.compensation_max}万/月`
    : (opp.compensation || '未記載');

  console.log(`  Status:     ${opp.status}`);
  console.log(`  報酬:       ${pay} (${opp.compensation || ''})`);
  console.log(`  稼働:       ${opp.work_frequency || '?'}  ${opp.work_style || '?'}`);
  console.log(`  開始時期:   ${opp.start_timing || '?'}`);
  console.log(`  所在地:     ${opp.location || '?'}`);
  if (opp.company_url) console.log(`  HP:         ${opp.company_url}`);
  console.log(`  適合度:     ${'⭐'.repeat(opp.ai_fit_score || 0)} (${opp.ai_fit_score || '?'}/5)`);
  if (opp.ai_fit_reason) console.log(`  理由:       ${opp.ai_fit_reason}`);
  console.log('');

  if (opp.summary) {
    console.log('  [案件概要]');
    console.log(`  ${opp.summary}`);
    console.log('');
  }

  if (opp.background) {
    console.log('  [依頼背景]');
    console.log(`  ${opp.background}`);
    console.log('');
  }

  if (opp.responsibilities) {
    console.log('  [業務内容]');
    console.log(`  ${opp.responsibilities}`);
    console.log('');
  }

  if (opp.team_structure) {
    console.log('  [体制]');
    console.log(`  ${opp.team_structure}`);
    console.log('');
  }

  if (opp.required_skills) {
    console.log('  [必須スキル]');
    try {
      const skills = JSON.parse(opp.required_skills);
      skills.forEach(s => console.log(`    • ${s}`));
    } catch {
      console.log(`  ${opp.required_skills}`);
    }
    console.log('');
  }

  if (opp.preferred_skills) {
    console.log('  [歓迎スキル]');
    try {
      const skills = JSON.parse(opp.preferred_skills);
      skills.forEach(s => console.log(`    • ${s}`));
    } catch {
      console.log(`  ${opp.preferred_skills}`);
    }
    console.log('');
  }

  if (opp.highlights) {
    console.log('  [おすすめポイント]');
    console.log(`  ${opp.highlights}`);
    console.log('');
  }

  console.log('  [エージェント]');
  console.log(`  ${opp.agent_name || '?'} (${opp.agent_company || '?'}) / ${opp.platform || '?'}`);
  if (opp.agent_email) console.log(`  Email: ${opp.agent_email}`);
  if (opp.agent_phone) console.log(`  TEL:   ${opp.agent_phone}`);
  console.log('');

  if (opp.notes) {
    console.log('  [メモ]');
    console.log(`  ${opp.notes}`);
    console.log('');
  }

  if (opp.reply_draft) {
    console.log('  [返信ドラフト]');
    console.log(`  ${opp.reply_draft}`);
    console.log('');
  }

  if (opp.next_action) {
    console.log(`  次のアクション: ${opp.next_action} (${opp.next_action_date || '日付未定'})`);
    console.log('');
  }

  if (emails.length > 0) {
    console.log('  [関連メール]');
    emails.forEach(e => {
      console.log(`    ${e.received_at?.slice(0, 10)} ${e.from_name || e.from_address}: ${e.subject}`);
    });
    console.log('');
  }

  if (history.length > 0) {
    console.log('  [ステータス履歴]');
    history.forEach(h => {
      const from = h.old_status ? `${h.old_status} → ` : '';
      console.log(`    ${h.changed_at?.slice(0, 16)} ${from}${h.new_status}${h.note ? ` (${h.note})` : ''}`);
    });
  }
}

module.exports = { show };
