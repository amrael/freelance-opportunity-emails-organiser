const { getDb } = require('../db');
const { generateReplyDraft } = require('../extractor');

async function reply(id, options = {}) {
  const db = getDb();
  const opp = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);

  if (!opp) {
    console.error(`Opportunity #${id} not found.`);
    process.exit(1);
  }

  if (options.show) {
    if (opp.reply_draft) {
      console.log('[返信ドラフト]');
      console.log(opp.reply_draft);
    } else {
      console.log('返信ドラフトはまだ生成されていません。');
    }
    return;
  }

  if (!options.note) {
    console.error('Usage: foe reply <id> --note "条件OK、面談希望"');
    console.error('       foe reply <id> --show');
    process.exit(1);
  }

  // Save note (append to existing notes)
  const { addNote } = require('./note');
  addNote(id, `[返信方針] ${options.note}`);

  console.log('Generating reply draft...\n');

  // Generate reply draft
  const draft = await generateReplyDraft(opp, options.note);

  if (draft) {
    db.prepare("UPDATE opportunities SET reply_draft = ?, updated_at = datetime('now') WHERE id = ?")
      .run(draft, id);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(draft);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\nDraft saved. Use "foe reply <id> --show" to view again.');
  } else {
    console.error('Failed to generate reply draft.');
  }
}

module.exports = { reply };
