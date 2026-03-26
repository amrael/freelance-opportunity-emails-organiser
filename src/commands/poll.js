const { getDb } = require('../db');
const { searchNewEmails, fetchEmail, isAgentEmail } = require('../imap');
const { extractOpportunity } = require('../extractor');
const { generateDedupKey, findByDedupKey } = require('../dedup');
const { notifyTelegram } = require('../notify');

async function poll() {
  const db = getDb();

  // Get the last processed UID and date
  const lastEmail = db.prepare('SELECT MAX(imap_uid) as maxUid, MAX(received_at) as lastDate FROM emails').get();
  const sinceDate = lastEmail?.lastDate
    ? new Date(new Date(lastEmail.lastDate).getTime() - 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // Default: last 7 days

  console.log(`Polling since: ${sinceDate.slice(0, 10)}`);

  // Search for emails
  const headers = await searchNewEmails({ since: sinceDate, max: 100 });
  console.log(`Found ${headers.length} email(s) in range`);

  // Filter to agent emails only
  const agentEmails = headers.filter(h => isAgentEmail(h.from));
  console.log(`Agent emails: ${agentEmails.length}`);

  // Check which are already fully processed (email exists AND linked to opportunity)
  const checkStmt = db.prepare('SELECT id, opportunity_id FROM emails WHERE imap_uid = ?');
  const newEmails = agentEmails.filter(h => {
    const existing = checkStmt.get(h.uid);
    return !existing || !existing.opportunity_id;
  });
  console.log(`New emails: ${newEmails.length}`);

  if (newEmails.length === 0) {
    console.log('No new opportunity emails.');
    return [];
  }

  const insertEmail = db.prepare(`
    INSERT INTO emails (imap_uid, message_id, from_address, from_name, subject, received_at, body_text, body_html, extracted_at, opportunity_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertOpp = db.prepare(`
    INSERT INTO opportunities (company_name, project_title, dedup_key, company_url, location,
      work_frequency, work_style, start_timing, compensation, compensation_min, compensation_max,
      summary, background, responsibilities, team_structure, required_skills, preferred_skills,
      highlights, agent_name, agent_company, agent_email, agent_phone, platform,
      ai_fit_score, ai_fit_reason, first_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateEmailOpp = db.prepare('UPDATE emails SET opportunity_id = ?, extracted_at = ? WHERE id = ?');

  const insertHistory = db.prepare(`
    INSERT INTO status_history (opportunity_id, old_status, new_status, note)
    VALUES (?, NULL, '新着', '自動取り込み')
  `);

  const results = [];

  for (const header of newEmails) {
    try {
      console.log(`\nProcessing UID ${header.uid}: ${header.subject}`);

      // Fetch full email
      const full = await fetchEmail(header.uid);

      // Insert email record (skip if already exists from a prior failed run)
      let emailId;
      const existingEmail = db.prepare('SELECT id FROM emails WHERE imap_uid = ?').get(header.uid);
      if (existingEmail) {
        emailId = existingEmail.id;
      } else {
        const emailResult = insertEmail.run(
          header.uid, header.messageId, header.from, header.fromName,
          header.subject, header.date,
          full.text, full.html, null, null
        );
        emailId = emailResult.lastInsertRowid;
      }

      // Extract with LLM
      const extracted = await extractOpportunity(header.subject, full.text || full.html);

      if (!extracted) {
        console.log(`  Warning: extraction failed, storing raw email only`);
        continue;
      }

      if (extracted.email_type && extracted.email_type !== 'opportunity') {
        console.log(`  Skipped: email_type="${extracted.email_type}" (not an opportunity)`);
        continue;
      }

      // Normalize to array: single or multiple opportunities per email
      const opportunities = extracted.opportunities
        ? extracted.opportunities
        : [extracted];

      let firstOppId = null;

      for (const opp of opportunities) {
        if (!opp.company_name) {
          console.log(`  Warning: no company name extracted, skipping one opportunity`);
          continue;
        }

        // Override agent info from email sender (LLM often confuses agent with client company)
        if (header.fromName) opp.agent_name = header.fromName;
        if (header.from) opp.agent_email = header.from;

        const dedupKey = generateDedupKey(opp.company_name, opp.project_title);
        const existing = findByDedupKey(db, dedupKey);

        let oppId;
        let isNew = false;

        if (existing) {
          oppId = existing.id;
          console.log(`  Duplicate detected: linked to existing #${oppId} (${existing.company_name})`);
        } else {
          // Coerce values for better-sqlite3: undefined → null, arrays/objects → JSON string
          const v = (x) => {
            if (x === undefined || x === null) return null;
            if (Array.isArray(x) || (typeof x === 'object')) return JSON.stringify(x);
            return x;
          };

          const oppResult = insertOpp.run(
            v(opp.company_name), v(opp.project_title), dedupKey,
            v(opp.company_url), v(opp.location),
            v(opp.work_frequency), v(opp.work_style), v(opp.start_timing),
            v(opp.compensation), v(opp.compensation_min), v(opp.compensation_max),
            v(opp.summary), v(opp.background), v(opp.responsibilities),
            v(opp.team_structure), v(opp.required_skills), v(opp.preferred_skills),
            v(opp.highlights), v(opp.agent_name), v(opp.agent_company),
            v(opp.agent_email), v(opp.agent_phone), v(opp.platform),
            v(opp.ai_fit_score), v(opp.ai_fit_reason),
            header.date
          );
          oppId = oppResult.lastInsertRowid;
          isNew = true;
          insertHistory.run(oppId);
          console.log(`  New opportunity #${oppId}: ${opp.company_name} - ${opp.project_title}`);
        }

        if (!firstOppId) firstOppId = oppId;

        if (isNew) {
          results.push({
            id: oppId,
            company: opp.company_name,
            title: opp.project_title,
            pay: opp.compensation,
            payMin: opp.compensation_min,
            payMax: opp.compensation_max,
            style: opp.work_style,
            fit: opp.ai_fit_score,
            fitReason: opp.ai_fit_reason,
            agent: opp.agent_company,
            platform: opp.platform,
          });
        }
      }

      // Link email to the first opportunity
      if (firstOppId) {
        updateEmailOpp.run(firstOppId, new Date().toISOString(), emailId);
      }
    } catch (err) {
      console.error(`  Error processing UID ${header.uid}: ${err.message}`);
    }
  }

  // Notify via Telegram if new opportunities
  if (results.length > 0) {
    const msg = formatTelegramMessage(results);
    await notifyTelegram(msg);
  }

  console.log(`\nDone. ${results.length} new opportunity(ies) added.`);
  return results;
}

function formatTelegramMessage(results) {
  const lines = [`📋 新着案件: ${results.length}件\n`];
  for (const r of results) {
    const pay = r.payMin && r.payMax
      ? `${r.payMin}-${r.payMax}万/月`
      : (r.pay || '未記載');
    const fit = r.fit ? `${'⭐'.repeat(r.fit)}` : '';
    lines.push(`━━━━━━━━━━━━━━━`);
    lines.push(`#${r.id} ${r.company}`);
    lines.push(`📌 ${r.title || '(タイトルなし)'}`);
    lines.push(`💰 ${pay}  🏠 ${r.style || '?'}`);
    lines.push(`${fit} ${r.fitReason || ''}`);
    lines.push(`🏢 ${r.agent || '?'} / ${r.platform || '?'}`);
  }
  return lines.join('\n');
}

module.exports = { poll };
