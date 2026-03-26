const fs = require('fs');
const path = require('path');
const Imap = require('imap');
const { simpleParser } = require('mailparser');

const CONFIG_PATH = path.join(process.env.HOME, '.openclaw', 'icloud_mail.json');

// Known agent domains to filter (comma-separated env var)
// Set FOE_AGENT_DOMAINS in .env — see .env.example
const AGENT_DOMAINS = (process.env.FOE_AGENT_DOMAINS || 'linkedin.com')
  .split(',')
  .map(d => d.trim())
  .filter(Boolean);

function getImapConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

/**
 * Search for new emails from agent domains since a given date.
 * Returns array of { uid, from, fromName, subject, date, messageId }
 */
async function searchNewEmails(options = {}) {
  const config = getImapConfig();

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);
    const results = [];
    let resolved = false;

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }

        const criteria = [];
        if (options.since) {
          const date = new Date(options.since);
          criteria.push(['SINCE', date.toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
          })]);
        }
        if (options.from) {
          criteria.push(['FROM', options.from]);
        }
        if (criteria.length === 0) criteria.push('ALL');

        imap.search(criteria, (err, uids) => {
          if (err) { imap.end(); return reject(err); }
          if (uids.length === 0) { imap.end(); return resolve([]); }

          const maxResults = options.max || 50;
          const limitedUids = uids.slice(-maxResults).reverse();

          const f = imap.fetch(limitedUids, {
            bodies: 'HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID)'
          });

          f.on('message', (msg) => {
            let uid;
            let buffer = '';

            msg.once('attributes', (attrs) => { uid = attrs.uid; });

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { buffer += chunk.toString('utf8'); });
              stream.once('end', () => {
                simpleParser(buffer, (err, parsed) => {
                  if (!err) {
                    results.push({
                      uid,
                      from: parsed.from?.value?.[0]?.address || '',
                      fromName: parsed.from?.value?.[0]?.name || '',
                      subject: parsed.subject || '(No subject)',
                      date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                      messageId: parsed.messageId || '',
                    });
                  }
                });
              });
            });
          });

          f.once('error', (err) => { imap.end(); reject(err); });

          f.once('end', () => {
            setTimeout(() => {
              imap.end();
              setTimeout(() => {
                if (!resolved) {
                  resolved = true;
                  results.sort((a, b) => b.uid - a.uid);
                  resolve(results);
                }
              }, 1500);
            }, 800);
          });
        });
      });
    });

    imap.once('error', (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });

    imap.once('end', () => {
      if (!resolved) {
        resolved = true;
        results.sort((a, b) => b.uid - a.uid);
        resolve(results);
      }
    });

    imap.connect();
  });
}

/**
 * Fetch full email content by UID.
 * Returns { uid, from, fromName, to, subject, date, messageId, text, html }
 */
async function fetchEmail(uid) {
  const config = getImapConfig();

  return new Promise((resolve, reject) => {
    const imap = new Imap(config);

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) { imap.end(); return reject(err); }

        const fetch = imap.fetch([uid], { bodies: '' });

        fetch.on('message', (msg) => {
          msg.on('body', (stream) => {
            simpleParser(stream, (err, parsed) => {
              if (err) { imap.end(); return reject(err); }

              imap.end();
              resolve({
                uid,
                from: parsed.from?.value?.[0]?.address || '',
                fromName: parsed.from?.value?.[0]?.name || '',
                to: parsed.to?.text || '',
                subject: parsed.subject || '(No subject)',
                date: parsed.date?.toISOString() || new Date().toISOString(),
                messageId: parsed.messageId || '',
                text: parsed.text || '',
                html: parsed.html || '',
              });
            });
          });
        });

        fetch.once('error', (err) => { imap.end(); reject(err); });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}

/**
 * Check if an email is from a known agent domain.
 */
function isAgentEmail(fromAddress) {
  if (!fromAddress) return false;
  const domain = fromAddress.split('@')[1]?.toLowerCase();
  return AGENT_DOMAINS.some(d => domain === d || domain?.endsWith('.' + d));
}

module.exports = { searchNewEmails, fetchEmail, isAgentEmail, AGENT_DOMAINS };
