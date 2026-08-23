const pool = require('./db/pool');

// Simple in-memory cache of custom phrases per guild, refreshed on writes and
// lazily on read-miss. Avoids hitting the DB on every single message.
const cache = new Map(); // guildId -> string[]

async function loadFromDb(guildId) {
  const { rows } = await pool.query(
    'SELECT phrase FROM custom_phrases WHERE guild_id = $1 ORDER BY phrase ASC',
    [guildId]
  );
  const phrases = rows.map((r) => r.phrase);
  cache.set(guildId, phrases);
  return phrases;
}

async function getCustomPhrases(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  return loadFromDb(guildId);
}

async function addPhrase(guildId, phrase, addedBy) {
  const normalized = phrase.toLowerCase().trim();
  if (!normalized) throw new Error('Phrase cannot be empty.');
  await pool.query(
    `INSERT INTO custom_phrases (guild_id, phrase, added_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, phrase) DO NOTHING`,
    [guildId, normalized, addedBy]
  );
  return loadFromDb(guildId);
}

async function removePhrase(guildId, phrase) {
  const normalized = phrase.toLowerCase().trim();
  const { rowCount } = await pool.query(
    'DELETE FROM custom_phrases WHERE guild_id = $1 AND phrase = $2',
    [guildId, normalized]
  );
  await loadFromDb(guildId);
  return rowCount > 0;
}

module.exports = { getCustomPhrases, addPhrase, removePhrase };
