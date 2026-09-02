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
  countOffencesSince,
  recordManualReset,
};
