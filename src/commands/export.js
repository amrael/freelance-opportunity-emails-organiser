const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');

const EXPORT_PATH = process.env.FOE_EXPORT_PATH
  ? path.resolve(process.env.FOE_EXPORT_PATH.replace(/^~/, process.env.HOME))
  : path.join(process.env.HOME, 'obsidian-vault', 'Freelance', '案件パイプライン.md');

function exportToObsidian() {
  const db = getDb();

  const activeStatuses = ['新着', '検討中', 'エントリー済', '面談済'];
  const opps = db.prepare(
    `SELECT * FROM opportunities WHERE status IN (${activeStatuses.map(() => '?').join(',')}) ORDER BY first_seen_at DESC`
  ).all(...activeStatuses);

  // Count by status
  const counts = db.prepare(
    'SELECT status, COUNT(*) as count FROM opportunities GROUP BY status'
  ).all();

  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  let md = `# フリーランス案件パイプライン\n`;
  md += `> Last updated: ${now}\n\n`;

  md += `## Summary\n`;
  for (const c of counts) {
    md += `- ${c.status}: ${c.count}件\n`;
  }
  const activeCount = opps.length;
  md += `- **アクティブ合計: ${activeCount}件**\n\n`;

  if (opps.length === 0) {
    md += `アクティブな案件はありません。\n`;
  } else {
    md += `## Active Opportunities\n\n`;
    md += `| ID | Status | Company | Title | Pay(万/月) | Style | Fit | Agent | Date |\n`;
    md += `|----|--------|---------|-------|-----------|-------|-----|-------|------|\n`;

    for (const o of opps) {
      const pay = o.compensation_min && o.compensation_max
        ? `${o.compensation_min}-${o.compensation_max}`
        : (o.compensation_min || o.compensation_max || '?');
      const date = o.first_seen_at ? o.first_seen_at.slice(0, 10) : '';
      const fit = o.ai_fit_score ? `${o.ai_fit_score}/5` : '?';
      md += `| ${o.id} | ${o.status} | ${o.company_name || ''} | ${o.project_title || ''} | ${pay} | ${o.work_style || '?'} | ${fit} | ${o.agent_company || ''} | ${date} |\n`;
    }
  }

  // Ensure directory exists
  const dir = path.dirname(EXPORT_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EXPORT_PATH, md, 'utf8');

  console.log(`Exported ${activeCount} active opportunities to ${EXPORT_PATH}`);
}

module.exports = { exportToObsidian };
