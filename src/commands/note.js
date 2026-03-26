const { getDb } = require('../db');

function addNote(id, noteText) {
  const db = getDb();
  const opp = db.prepare('SELECT id, notes, company_name FROM opportunities WHERE id = ?').get(id);

  if (!opp) {
    console.error(`Opportunity #${id} not found.`);
    process.exit(1);
  }

  const timestamp = new Date().toISOString().slice(0, 16);
  const newNote = opp.notes
    ? `${opp.notes}\n[${timestamp}] ${noteText}`
    : `[${timestamp}] ${noteText}`;

  db.prepare("UPDATE opportunities SET notes = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newNote, id);

  console.log(`Note added to #${id} (${opp.company_name})`);
}

module.exports = { addNote };
