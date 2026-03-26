const { getDb } = require('../db');

function setFollowup(id, date, action) {
  const db = getDb();
  const opp = db.prepare('SELECT id, company_name FROM opportunities WHERE id = ?').get(id);

  if (!opp) {
    console.error(`Opportunity #${id} not found.`);
    process.exit(1);
  }

  db.prepare("UPDATE opportunities SET next_action = ?, next_action_date = ?, updated_at = datetime('now') WHERE id = ?")
    .run(action || null, date || null, id);

  console.log(`Followup set for #${id} (${opp.company_name}): ${action || '?'} by ${date || '?'}`);
}

module.exports = { setFollowup };
