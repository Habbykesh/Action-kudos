const pool = require('../db/pool');

// Simple in-memory cache of custom pidgin terms per guild, refreshed on
// writes and lazily on read-miss — same pattern as customPhrases.js for
// the Thank-You layer, kept as a separate cache/table for independence.
const cache = new Map(); // guildId -> string[]

async function loadFromDb(guildId) {
  const { rows } = await pool.query(
    'SELECT term FROM pidgin_terms WHERE guild_id = $1 ORDER BY term ASC',
    [guildId]
  );
  const terms = rows.map((r) => r.term);
  cache.set(guildId, terms);
  return terms;
}

async function getCustomTerms(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  return loadFromDb(guildId);
}

async function addTerm(guildId, term, addedBy) {
  const normalized = term.toLowerCase().trim();
  if (!normalized) throw new Error('Term cannot be empty.');
  await pool.query(
    `INSERT INTO pidgin_terms (guild_id, term, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, term) DO NOTHING`,
    [guildId, normalized, addedBy]
  );
  return loadFromDb(guildId);
}

async function removeTerm(guildId, term) {
  const normalized = term.toLowerCase().trim();
  const { rowCount } = await pool.query(
    'DELETE FROM pidgin_terms WHERE guild_id = $1 AND term = $2',
    [guildId, normalized]
  );
  await loadFromDb(guildId);
  return rowCount > 0;
}

module.exports = { getCustomTerms, addTerm, removeTerm };
