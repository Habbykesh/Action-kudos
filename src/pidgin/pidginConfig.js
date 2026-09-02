const pool = require('../db/pool');

// Independent caches from the Thank-You layer (systemState.js) — deliberate,
// so nothing about the Pidgin layer's state depends on Thank-You internals.
const enabledCache = new Map(); // guildId -> boolean
const excludedCache = new Map(); // guildId -> Set<channelId>

async function ensureGuildRow(guildId) {
  await pool.query(
    `INSERT INTO pidgin_config (guild_id) VALUES ($1)
     ON CONFLICT (guild_id) DO NOTHING`,
    [guildId]
  );
}

async function isEnabled(guildId) {
  if (enabledCache.has(guildId)) return enabledCache.get(guildId);
  const { rows } = await pool.query('SELECT enabled FROM pidgin_config WHERE guild_id = $1', [guildId]);
  const enabled = rows[0]?.enabled ?? false;
  enabledCache.set(guildId, enabled);
  return enabled;
}

async function setEnabled(guildId, enabled) {
  await pool.query(
    `INSERT INTO pidgin_config (guild_id, enabled) VALUES ($1, $2)
     ON CONFLICT (guild_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
    [guildId, enabled]
  );
  enabledCache.set(guildId, enabled);
}

async function getPoRoleIds(guildId) {
  const { rows } = await pool.query(
    'SELECT po1_role_id, po2_role_id, po3_role_id FROM pidgin_config WHERE guild_id = $1',
    [guildId]
  );
  const row = rows[0] || {};
  return {
    po1RoleId: row.po1_role_id || null,
    po2RoleId: row.po2_role_id || null,
    po3RoleId: row.po3_role_id || null,
  };
}

async function setPoRoleIds(guildId, { po1, po2, po3 }) {
  await pool.query(
    `INSERT INTO pidgin_config (guild_id, po1_role_id, po2_role_id, po3_role_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE
       SET po1_role_id = EXCLUDED.po1_role_id,
           po2_role_id = EXCLUDED.po2_role_id,
           po3_role_id = EXCLUDED.po3_role_id,
           updated_at = now()`,
    [guildId, po1, po2, po3]
  );
}

async function loadExcludedFromDb(guildId) {
  const { rows } = await pool.query(
    'SELECT channel_id FROM pidgin_excluded_channels WHERE guild_id = $1',
    [guildId]
  );
  const set = new Set(rows.map((r) => r.channel_id));
  excludedCache.set(guildId, set);
  return set;
}

async function getExcludedChannelSet(guildId) {
  if (excludedCache.has(guildId)) return excludedCache.get(guildId);
  return loadExcludedFromDb(guildId);
}

async function getExcludedChannels(guildId) {
  const set = await getExcludedChannelSet(guildId);
  return Array.from(set);
}

async function isChannelExcluded(guildId, channelId) {
  const set = await getExcludedChannelSet(guildId);
  return set.has(channelId);
}

// Enforcement is server-wide by default (per spec §9). "Excluding" a
// channel removes it from scope; "including" it again restores enforcement
// there. This is what /pidgin channels add|remove operate on.
async function excludeChannel(guildId, channelId, excludedBy) {
  const { rowCount } = await pool.query(
    `INSERT INTO pidgin_excluded_channels (guild_id, channel_id, excluded_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, channel_id) DO NOTHING`,
    [guildId, channelId, excludedBy]
  );
  await loadExcludedFromDb(guildId);
  return rowCount > 0;
}

async function includeChannel(guildId, channelId) {
  const { rowCount } = await pool.query(
    'DELETE FROM pidgin_excluded_channels WHERE guild_id = $1 AND channel_id = $2',
    [guildId, channelId]
  );
  await loadExcludedFromDb(guildId);
  return rowCount > 0;
}

module.exports = {
  ensureGuildRow,
  isEnabled,
  setEnabled,
  getPoRoleIds,
  setPoRoleIds,
  getExcludedChannels,
  isChannelExcluded,
  excludeChannel,
  includeChannel,
};
