// Offence counting is derived, not stored as a mutable counter: the
// "current daily count" is always COUNT(offences today since the most
// recent reset point). This is what lets /pidgin reset zero out a user's
// active count (per spec §16) while historical offence rows stay in the
// database forever, untouched.

function utcDayBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

async function getLastManualResetToday(dbClient, guildId, userId, dayStart, dayEnd) {
  const { rows } = await dbClient.query(
    `SELECT created_at FROM pidgin_manual_resets
     WHERE guild_id = $1 AND user_id = $2 AND created_at >= $3 AND created_at < $4
     ORDER BY created_at DESC
     LIMIT 1`,
    [guildId, userId, dayStart, dayEnd]
  );
  return rows[0]?.created_at || null;
}

async function getLastGuildResetToday(dbClient, guildId, dayStart, dayEnd) {
  const { rows } = await dbClient.query(
    `SELECT created_at FROM pidgin_guild_resets
     WHERE guild_id = $1 AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [guildId, dayStart, dayEnd]
  );
  return rows[0]?.created_at || null;
}

/**
 * The effective "count since" point for a user's active daily count is the
 * latest of: the start of the UTC day, their own most recent manual reset
 * today, or the guild's most recent bulk reset today. Whichever is latest
 * wins — history in pidgin_offences is never touched by any of this.
 */
function latestResetPoint(dayStart, userReset, guildReset) {
  let latest = dayStart;
  if (userReset && userReset > latest) latest = userReset;
  if (guildReset && guildReset > latest) latest = guildReset;
  return latest;
}

async function recordGuildReset(dbClient, guildId, resetBy) {
  await dbClient.query(
    `INSERT INTO pidgin_guild_resets (guild_id, reset_by) VALUES ($1, $2)`,
    [guildId, resetBy]
  );
}

/**
 * Read-only lookup of a user's current active offence count for today —
 * used by /pidgin streak. Takes a plain pool (not a transaction client)
 * since it's just a status check, not part of recording a new offence.
 */
async function getCurrentStreak(pool, guildId, userId, date = new Date()) {
  const { start: dayStart, end: dayEnd } = utcDayBounds(date);
  const lastUserReset = await getLastManualResetToday(pool, guildId, userId, dayStart, dayEnd);
  const lastGuildReset = await getLastGuildResetToday(pool, guildId, dayStart, dayEnd);
  const countSince = latestResetPoint(dayStart, lastUserReset, lastGuildReset);
  const count = await countOffencesSince(pool, guildId, userId, countSince, dayEnd);
  return { count, countSince, dayStart, dayEnd };
}

async function countOffencesSince(dbClient, guildId, userId, since, until) {
  const { rows } = await dbClient.query(
    `SELECT COUNT(*)::int AS count FROM pidgin_offences
     WHERE guild_id = $1 AND user_id = $2 AND created_at >= $3 AND created_at < $4`,
    [guildId, userId, since, until]
  );
  return rows[0].count;
}

async function recordManualReset(dbClient, guildId, userId, resetBy) {
  await dbClient.query(
    `INSERT INTO pidgin_manual_resets (guild_id, user_id, reset_by) VALUES ($1, $2, $3)`,
    [guildId, userId, resetBy]
  );
}

module.exports = {
  utcDayBounds,
  getLastManualResetToday,
  getLastGuildResetToday,
  latestResetPoint,
  countOffencesSince,
  recordManualReset,
  recordGuildReset,
  getCurrentStreak,
};
