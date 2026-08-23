const { PermissionFlagsBits, SnowflakeUtil, ChannelType } = require('discord.js');
const botConfig = require('./botConfig');
const systemState = require('./systemState');
const { tryProcessThankYou } = require('./rewardService');

const MAX_PAGES_PER_CHANNEL = 50; // 50 * 100 = up to 5000 messages per channel

function snowflakeForTimestamp(date) {
  return SnowflakeUtil.generate({ timestamp: date.getTime() }).toString();
}

async function scanChannel(client, channel, afterSnowflake) {
  let cursor = afterSnowflake;
  let pages = 0;

  // Discord's `after` pagination doesn't guarantee ascending order in the
  // response, so we track the max id seen and always advance the cursor to
  // it, deduping by message id, until a page comes back smaller than the
  // page size (meaning we've reached "now").
  const seen = new Set();

  while (pages < MAX_PAGES_PER_CHANNEL) {
    pages += 1;
    const batch = await channel.messages.fetch({ after: cursor, limit: 100 }).catch(() => null);
    if (!batch || batch.size === 0) break;

    let maxId = cursor;
    for (const message of batch.values()) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (BigInt(message.id) > BigInt(maxId)) maxId = message.id;
      await tryProcessThankYou(client, message);
    }

    if (batch.size < 100) break;
    if (maxId === cursor) break; // safety: no progress, avoid infinite loop
    cursor = maxId;
  }
}

/**
 * Scans every readable text channel in the guild for messages sent since the
 * bot's last heartbeat, running them through the same validation pipeline as
 * real-time messages. Idempotent: already-processed thank-yous are skipped
 * via the DB's unique constraint.
 */
async function recoverGuild(client, guild) {
  const lastSeen = await botConfig.getLastSeen(guild.id);

  if (!lastSeen) {
    // No last_seen on record means this is the bot's very first startup for
    // this guild — there's no real "downtime" to recover from, so don't
    // backfill history. Just mark "now" as the starting point and move on.
    console.log(`[recovery] First-ever startup for guild ${guild.id} — skipping backfill, starting fresh from now.`);
    await botConfig.updateLastSeen(guild.id, new Date());
    return;
  }

  const since = new Date(lastSeen);
  console.log(`[recovery] Scanning guild ${guild.id} for messages since ${since.toISOString()}`);

  const enabled = await systemState.isEnabled(guild.id);
  if (!enabled) {
    // The system is deliberately turned off — don't burn API calls scanning
    // history that would just get ignored anyway. Just move the checkpoint
    // forward so a later /rewards enable starts clean from "now".
    console.log(`[recovery] System is disabled for guild ${guild.id} — skipping scan.`);
    await botConfig.updateLastSeen(guild.id, new Date());
    return;
  }

  const afterSnowflake = snowflakeForTimestamp(since);
  const me = guild.members.me;

  const channels = guild.channels.cache.filter((c) => {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)) return false;
    if (!me) return false;
    const perms = c.permissionsFor(me);
    return perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.ReadMessageHistory);
  });

  for (const channel of channels.values()) {
    try {
      await scanChannel(client, channel, afterSnowflake);
    } catch (err) {
      console.error(`[recovery] Failed scanning channel ${channel.id}:`, err);
    }
  }

  await botConfig.updateLastSeen(guild.id, new Date());
  console.log(`[recovery] Finished scanning guild ${guild.id}`);
}

module.exports = { recoverGuild };
