const { getDb } = require('../db');

const VALID_STATUSES = ['新着', '検討中', 'エントリー済', '面談済', '辞退', 'アンマッチ', '成約', '対象外'];

function updateStatus(id, newStatus, note) {
  if (!VALID_STATUSES.includes(newStatus)) {
    console.error(`Invalid status: ${newStatus}`);
    console.error(`Valid: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const db = getDb();
  const opp = db.prepare('SELECT id, status, notes, company_name FROM opportunities WHERE id = ?').get(id);

  if (!opp) {
    console.error(`Opportunity #${id} not found.`);
    process.exit(1);
  }

  if (opp.status === newStatus) {
    console.log(`Opportunity #${id} is already "${newStatus}".`);
    return;
  }

  const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo', hour12: false }).slice(0, 16);
  const statusNote = `[${timestamp}] ${opp.status} → ${newStatus}${note ? ': ' + note : ''}`;
  const newNotes = opp.notes ? `${opp.notes}\n${statusNote}` : statusNote;

  db.prepare("UPDATE opportunities SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newStatus, newNotes, id);

  db.prepare('INSERT INTO status_history (opportunity_id, old_status, new_status, note) VALUES (?, ?, ?, ?)')
    .run(id, opp.status, newStatus, note || null);

  console.log(`#${id} ${opp.company_name}: ${opp.status} → ${newStatus}`);
}

module.exports = { updateStatus, VALID_STATUSES };
