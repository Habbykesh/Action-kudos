const pool = require('./db/pool');
const botConfig = require('./botConfig');

const cache = new Map(); // guildId -> boolean

async function isEnabled(guildId) {
  if (cache.has(guildId)) return cache.get(guildId);
  const { rows } = await pool.query('SELECT enabled FROM bot_config WHERE guild_id = $1', [guildId]);
  const enabled = rows[0]?.enabled ?? false;
  cache.set(guildId, enabled);
  return enabled;
}

async function setEnabled(guildId, enabled) {
  await pool.query(
    `INSERT INTO bot_config (guild_id, enabled) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [guildId, enabled]
  );
  cache.set(guildId, enabled);

  if (!enabled) {
    // Fast-forward the recovery checkpoint to "now" so that a future restart
    // never backfills the period the system was intentionally turned off
    // for — being disabled is a deliberate choice, not downtime to recover.
    await botConfig.updateLastSeen(guildId, new Date());
  }
}

module.exports = { isEnabled, setEnabled };
