const pool = require('./db/pool');

async function ensureGuildRow(guildId) {
  await pool.query(
    `INSERT INTO bot_config (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );
}

async function getHelperRoleId(guildId) {
  const { rows } = await pool.query(
    'SELECT helper_role_id FROM bot_config WHERE guild_id = $1',
    [guildId]
  );
  return rows[0]?.helper_role_id || null;
}

async function setHelperRoleId(guildId, roleId) {
  await pool.query(
    `INSERT INTO bot_config (guild_id, helper_role_id) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET helper_role_id = EXCLUDED.helper_role_id`,
    [guildId, roleId]
  );
}

async function getLastSeen(guildId) {
  const { rows } = await pool.query(
    'SELECT last_seen FROM bot_config WHERE guild_id = $1',
    [guildId]
  );
  return rows[0]?.last_seen || null;
}

async function updateLastSeen(guildId, date = new Date()) {
  await pool.query(
    `INSERT INTO bot_config (guild_id, last_seen) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET last_seen = EXCLUDED.last_seen`,
    [guildId, date]
  );
}

module.exports = {
  ensureGuildRow,
  getHelperRoleId,
  setHelperRoleId,
  getLastSeen,
  updateLastSeen,
};
