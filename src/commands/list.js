const { getDb } = require('../db');

function list(options = {}) {
  const db = getDb();

  let where = [];
  let params = [];

  if (options.status) {
    where.push('status = ?');
    params.push(options.status);
  } else if (!options.all) {
    where.push("status NOT IN ('辞退', 'アンマッチ', '成約', '対象外')");
  }

  if (options.minPay) {
    where.push('compensation_max >= ?');
    params.push(options.minPay);
  }

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const sql = `SELECT id, status, compensation_min, compensation_max, company_name, project_title,
    agent_company, platform, ai_fit_score, first_seen_at, work_style, next_action_date, notes
    FROM opportunities ${whereClause} ORDER BY first_seen_at DESC`;

  const rows = db.prepare(sql).all(...params);

  if (rows.length === 0) {
    console.log('No opportunities found.');
    return;
  }

  // Header
  const header = padRow('ID', 'Status', 'Pay(万)', 'Company', 'Title', 'Agent', 'Fit', 'Date');
  console.log(header);
  console.log('─'.repeat(header.length));

  for (const r of rows) {
    const pay = r.compensation_min && r.compensation_max
      ? `${r.compensation_min}-${r.compensation_max}`
      : (r.compensation_min || r.compensation_max || '?');
    const date = r.first_seen_at ? r.first_seen_at.slice(5, 10) : '';
    const fit = r.ai_fit_score ? `${r.ai_fit_score}/5` : '?';
    const company = truncate(r.company_name || '', 16);
    const title = truncate(r.project_title || '', 20);
    const agent = truncate(r.agent_company || r.platform || '', 10);

    console.log(padRow(
      String(r.id),
      statusIcon(r.status) + r.status,
      String(pay),
      company,
      title,
      agent,
      fit,
      date
    ));
    if (options.notes && r.notes) {
      for (const line of r.notes.split('\n')) {
        console.log('    ' + line);
      }
    }
  }

  console.log(`\n${rows.length} opportunity(ies)`);
}

function statusIcon(status) {
  const icons = {
    '新着': '🆕 ',
    '検討中': '🔍 ',
    'エントリー済': '📨 ',
    '面談済': '🤝 ',
    '辞退': '❌ ',
    'アンマッチ': '👻 ',
    '成約': '✅ ',
    '対象外': '🚫 ',
  };
  return icons[status] || '';
}

function truncate(s, len) {
  // Account for wide characters (Japanese = 2 width each)
  let width = 0;
  let i = 0;
  for (; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const w = (c > 0x7F) ? 2 : 1;
    if (width + w > len) break;
    width += w;
  }
  return i < s.length ? s.slice(0, i) + '..' : s;
}

function padRow(...cols) {
  const widths = [4, 14, 8, 18, 22, 12, 4, 6];
  return cols.map((c, i) => {
    const w = widths[i] || 10;
    // Simple padding (not perfect for CJK but good enough)
    return (c || '').padEnd(w);
  }).join(' ');
}

module.exports = { list };
