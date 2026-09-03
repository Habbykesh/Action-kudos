const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const pool = require('./db/pool');
const config = require('./config');
const { isAppreciation } = require('./phraseEngine');
const { ensureHelperRole } = require('./helperRole');
const audit = require('./audit');
const systemState = require('./systemState');
const { classifyThankYou } = require('./aiVerifier');

const HELP_WINDOW_MS = config.helpWindowHours * 60 * 60 * 1000;

// How long the public "Helper Recognized!" reward message stays in the
// channel before auto-deleting. The database record is permanent — this
// only affects the visible chat message.
const REWARD_MESSAGE_DELETE_MS = 60 * 1000;

// Reward states that represent an actual (or pending-legacy) reward, for
// purposes of daily caps / pair-per-day limits. ai_rejected and ai_failed
// rows exist purely for dedupe + audit trail and must never count against
// a user's limits.
const COUNTS_TOWARD_LIMITS = ['completed', 'pending', 'flagged_duplicate'];

function utcDayBounds(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Fast, cheap pre-checks that don't need the DB or Discord API beyond what's
 * already on the message objects. Returns true if this pair of messages is
 * even worth considering as a thank-you interaction.
 */
function passesBasicShape(thankMessage, helpMessage) {
  if (!helpMessage) return false;
  if (thankMessage.author.bot) return false;
  if (helpMessage.author.bot) return false;
  if (helpMessage.author.id === thankMessage.author.id) return false; // can't thank yourself

  const delta = thankMessage.createdTimestamp - helpMessage.createdTimestamp;
  if (delta < 0 || delta > HELP_WINDOW_MS) return false;

  return true;
}

/**
 * Attempts to process a message as a potential thank-you. Safe to call for
 * every message; it no-ops quickly if the message doesn't qualify. Also safe
 * to call twice for the same message (e.g. real-time + recovery overlap) —
 * the DB's unique constraint on thank_message_id prevents double rewards
 * (and double AI calls once a row for this message exists).
 */
async function tryProcessThankYou(client, message) {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.reference?.messageId) return;

    const enabled = await systemState.isEnabled(message.guild.id);
    if (!enabled) return;

    const helpMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);
    if (!passesBasicShape(message, helpMessage)) return;

    const matched = await isAppreciation(message.guild.id, message.content);
    if (!matched) return;

    await processValidThankYou(client, message, helpMessage);
  } catch (err) {
    console.error('[rewardService] Error while processing potential thank-you:', err);
  }
}

/**
 * All deterministic eligibility checks — cheap, DB/permission based, no AI
 * involved. This runs BEFORE the AI call so a request that would be
 * rejected anyway (duplicate, over a daily cap, etc.) never burns Gemini
 * quota. See spec §9 ("AI Usage Optimization").
 */
async function checkEligibility({ helperId, thankerId, thankMessageId, dayStart, dayEnd }) {
  const already = await pool.query('SELECT 1 FROM reward_events WHERE thank_message_id = $1', [thankMessageId]);
  if (already.rowCount > 0) return false;

  const pairToday = await pool.query(
    `SELECT 1 FROM reward_events
     WHERE helper_id = $1 AND thanker_id = $2
       AND created_at >= $3 AND created_at < $4
       AND reward_state = ANY($5)
     LIMIT 1`,
    [helperId, thankerId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (pairToday.rowCount > 0) return false;

  const helperCountToday = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reward_events
     WHERE helper_id = $1 AND created_at >= $2 AND created_at < $3 AND reward_state = ANY($4)`,
    [helperId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (helperCountToday.rows[0].count >= config.helperDailyLimit) return false;

  const thankerCountToday = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reward_events
     WHERE thanker_id = $1 AND created_at >= $2 AND created_at < $3 AND reward_state = ANY($4)`,
    [thankerId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (thankerCountToday.rows[0].count >= config.thankerDailyLimit) return false;

  return true;
}

/**
 * A small window of prior channel messages, oldest first, to give the AI
 * verifier extra context per spec §3. Kept small and best-effort — if this
 * fails, verification still proceeds with just the two messages.
 */
async function fetchContextMessages(channel, helpMessage) {
  if (config.geminiContextMessageCount <= 0) return [];
  try {
    const fetched = await channel.messages.fetch({ limit: config.geminiContextMessageCount, before: helpMessage.id });
    return Array.from(fetched.values())
      .reverse()
      .filter((m) => !m.author.bot)
      .map((m) => ({ author: m.author.username, content: m.content }));
  } catch (err) {
    console.error('[rewardService] Failed to fetch context messages for AI verification:', err);
    return [];
  }
}

async function processValidThankYou(client, thankMessage, helpMessage) {
  const guild = thankMessage.guild;
  const helperId = helpMessage.author.id;
  const thankerId = thankMessage.author.id;

  const helperMember = await guild.members.fetch(helperId).catch(() => null);
  if (!helperMember) return; // helper left the server
  if (helperMember.user.bot) return;

  // Members with Manage Server are excluded from the automatic reward —
  // helping is already part of their role.
  if (helperMember.permissions.has(PermissionFlagsBits.ManageGuild)) return;

  const { start: dayStart, end: dayEnd } = utcDayBounds(new Date(thankMessage.createdTimestamp));

  const eligible = await checkEligibility({
    helperId,
    thankerId,
    thankMessageId: thankMessage.id,
    dayStart,
    dayEnd,
  });
  if (!eligible) return;

  // ---- AI verification: only reached after every deterministic check
  // above has passed, to conserve free-tier Gemini quota (spec §9). ----
  const contextMessages = await fetchContextMessages(thankMessage.channel, helpMessage);
  const verification = await classifyThankYou({ thankMessage, helpMessage, contextMessages });

  if (!verification) {
    // Timeout, error, invalid/unexpected response, or quota exceeded —
    // never reward on an AI failure. Log it so it can be investigated.
    await logNonReward(client, { guild, helperId, thankerId, helpMessage, thankMessage, state: 'ai_failed' });
    return;
  }

  if (verification.classification !== 'GENUINE_HELP') {
    await logNonReward(client, { guild, helperId, thankerId, helpMessage, thankMessage, state: 'ai_rejected' });
    return;
  }

  await grantReward(client, { guild, helperMember, thankerId, helpMessage, thankMessage });
}

/**
 * Records a non-reward outcome (AI said PLEASANTRY, or AI verification
 * failed). This still writes a row keyed on the unique thank_message_id so
 * the same message is never reprocessed/re-classified twice (e.g. via
 * downtime recovery), and — for failures specifically — posts to the audit
 * channel so a human can review it (spec §8).
 */
async function logNonReward(client, { guild, helperId, thankerId, helpMessage, thankMessage, state }) {
  try {
    await pool.query(
      `INSERT INTO reward_events
         (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
          channel_id, reward_type, reward_amount, og_status, reward_state)
       VALUES ($1,$2,$3,$4,$5,$6,'none',0,true,$7)
       ON CONFLICT (thank_message_id) DO NOTHING`,
      [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id, state]
    );
  } catch (err) {
    console.error('[rewardService] Failed to log non-reward event:', err);
  }

  if (state === 'ai_failed') {
    await audit
      .postAiVerificationFailure(client, {
        guildId: guild.id,
        channelId: thankMessage.channel.id,
        helperId,
        thankerId,
        helpMessageId: helpMessage.id,
        thankMessageId: thankMessage.id,
      })
      .catch((err) => console.error('[rewardService] Failed to post AI failure audit log:', err));
  }
}

/**
 * Grants the universal 1,000 AP reward. Every eligible, AI-verified helper
 * gets the same reward now — no OG/non-OG distinction.
 */
async function grantReward(client, { guild, helperMember, thankerId, helpMessage, thankMessage }) {
  const helperId = helperMember.id;
  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const already = await dbClient.query('SELECT 1 FROM reward_events WHERE thank_message_id = $1', [thankMessage.id]);
    if (already.rowCount > 0) {
      await dbClient.query('ROLLBACK');
      return;
    }

    const helperRole = await ensureHelperRole(guild);

    if (helperMember.roles.cache.has(helperRole.id)) {
      // Already holds the role — don't double-trigger the MEE6 automation.
      await dbClient.query(
        `INSERT INTO reward_events
           (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
            channel_id, reward_type, reward_amount, og_status, reward_state)
         VALUES ($1,$2,$3,$4,$5,$6,'action_point',0,true,'flagged_duplicate')
         ON CONFLICT (thank_message_id) DO NOTHING`,
        [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id]
      );
      await dbClient.query('COMMIT');

      await audit.postDuplicateHelperRoleFlag(client, {
        guildId: guild.id,
        channelId: thankMessage.channel.id,
        helperId,
        thankerId,
        helpMessageId: helpMessage.id,
        thankMessageId: thankMessage.id,
      });
      return;
    }

    const insertResult = await dbClient.query(
      `INSERT INTO reward_events
         (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
          channel_id, reward_type, reward_amount, og_status, reward_state)
       VALUES ($1,$2,$3,$4,$5,$6,'action_point',$7,true,'completed')
       ON CONFLICT (thank_message_id) DO NOTHING
       RETURNING id`,
      [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id, config.actionPointsPerReward]
    );
    await dbClient.query('COMMIT');

    if (insertResult.rowCount === 0) return; // lost a race, another path already handled it

    await helperMember.roles.add(helperRole.id, 'Community helper reward — Action Points via MEE6 (AI-verified genuine help)');

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('🎉 Helper Recognized!')
      .setDescription("You've been recognized for helping a fellow builder!")
      .addFields(
        { name: '🏆 Reward Earned', value: `${config.actionPointsPerReward} Action Points`, inline: true },
        { name: '✅ Status', value: 'Awarded', inline: true },
      )
      .setFooter({ text: 'Keep it up! 🙌' });

    await thankMessage.channel.send({ content: `<@${helperId}>`, embeds: [embed] }).then((sent) => {
      setTimeout(() => {
        sent.delete().catch(() => {});
      }, REWARD_MESSAGE_DELETE_MS);
    });

    await audit.postActionPointReward(client, {
      guildId: guild.id,
      channelId: thankMessage.channel.id,
      helperId,
      thankerId,
      helpMessageId: helpMessage.id,
      thankMessageId: thankMessage.id,
      amount: config.actionPointsPerReward,
    });
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('[rewardService] Failed to grant reward:', err);
  } finally {
    dbClient.release();
  }
}

module.exports = { tryProcessThankYou };
