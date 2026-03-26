/**
 * Generate a dedup key from company name and project title.
 * Normalizes by removing common prefixes, whitespace, and lowercasing.
 */
function generateDedupKey(companyName, projectTitle) {
  if (!companyName) return null;
  const norm = (s) => {
    const str = (typeof s === 'string') ? s : String(s || '');
    return str
      .replace(/株式会社|（株）|\(株\)|有限会社|合同会社/g, '')
      .replace(/[\s　・、。,.\-_]/g, '')
      .toLowerCase()
      .trim();
  };
  return `${norm(companyName)}|${norm(projectTitle)}`;
}

/**
 * Find existing opportunity by dedup key.
 */
function findByDedupKey(db, dedupKey) {
  if (!dedupKey) return null;
  return db.prepare('SELECT * FROM opportunities WHERE dedup_key = ?').get(dedupKey);
}

module.exports = { generateDedupKey, findByDedupKey };
