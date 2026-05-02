const { getDb } = require('../db');

function stats() {
  const db = getDb();

  const statusCounts = db.prepare(
    'SELECT status, COUNT(*) as count FROM opportunities GROUP BY status ORDER BY count DESC'
  ).all();

  const totalEmails = db.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  const totalOpps = db.prepare('SELECT COUNT(*) as count FROM opportunities').get().count;

  const avgPay = db.prepare(
    'SELECT AVG(compensation_min) as avgMin, AVG(compensation_max) as avgMax FROM opportunities WHERE compensation_min IS NOT NULL'
  ).get();

  const topAgents = db.prepare(
    'SELECT agent_company, COUNT(*) as count FROM opportunities WHERE agent_company IS NOT NULL GROUP BY agent_company ORDER BY count DESC LIMIT 5'
  ).all();

  const topPlatforms = db.prepare(
    'SELECT platform, COUNT(*) as count FROM opportunities WHERE platform IS NOT NULL GROUP BY platform ORDER BY count DESC LIMIT 5'
  ).all();

  const pendingFollowups = db.prepare(
    `SELECT id, company_name, next_action, next_action_date FROM opportunities
     WHERE next_action IS NOT NULL AND status NOT IN ('辞退', 'アンマッチ', '成約')
     ORDER BY next_action_date ASC`
  ).all();

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  FOE Statistics');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  console.log(`\n  Total emails:        ${totalEmails}`);
  console.log(`  Total opportunities: ${totalOpps}`);
  if (avgPay.avgMin) {
    console.log(`  Avg compensation:    ${Math.round(avgPay.avgMin)}-${Math.round(avgPay.avgMax)}万/月`);
  }

  console.log('\n  [Status]');
  for (const s of statusCounts) {
    console.log(`    ${s.status}: ${s.count}`);
  }

  if (topAgents.length > 0) {
    console.log('\n  [Top Agents]');
    for (const a of topAgents) {
      console.log(`    ${a.agent_company}: ${a.count}件`);
    }
  }

  if (topPlatforms.length > 0) {
    console.log('\n  [Top Platforms]');
    for (const p of topPlatforms) {
      console.log(`    ${p.platform}: ${p.count}件`);
    }
  }

  if (pendingFollowups.length > 0) {
    console.log('\n  [Pending Followups]');
    for (const f of pendingFollowups) {
      console.log(`    #${f.id} ${f.company_name}: ${f.next_action} (${f.next_action_date || 'TBD'})`);
    }
  }

  console.log('');
}

module.exports = { stats };
