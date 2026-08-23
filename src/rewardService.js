const { PermissionFlagsBits } = require('discord.js');
const pool = require('./db/pool');
const config = require('./config');
const { isAppreciation } = require('./phraseEngine');
const { ensureHelperRole } = require('./helperRole');
const audit = require('./audit');

const HELP_WINDOW_MS = config.helpWindowHours * 60 * 60 * 1000;

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
 * the DB's unique constraint on thank_message_id prevents double rewards.
 */
async function tryProcessThankYou(client, message) {
  try {
    if (!message.guild) return;
    if (message.author.bot) return;
    if (!message.reference?.messageId) return;

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

  const client_ = await pool.connect();
  try {
    await client_.query('BEGIN');

    // Dedupe: has this exact thank-you message already produced a reward?
    // (Handled by the UNIQUE constraint on thank_message_id at INSERT time,
    // but we also short-circuit here for clarity/perf.)
    const already = await client_.query(
      'SELECT 1 FROM reward_events WHERE thank_message_id = $1',
      [thankMessage.id]
    );
    if (already.rowCount > 0) {
      await client_.query('ROLLBACK');
      return;
    }

    // Same thanker -> same helper: max once per UTC calendar day.
    const pairToday = await client_.query(
      `SELECT 1 FROM reward_events
       WHERE helper_id = $1 AND thanker_id = $2
         AND created_at >= $3 AND created_at < $4
       LIMIT 1`,
      [helperId, thankerId, dayStart, dayEnd]
    );
    if (pairToday.rowCount > 0) {
      await client_.query('ROLLBACK');
      return;
    }

    // Helper daily cap.
    const helperCountToday = await client_.query(
      `SELECT COUNT(*)::int AS count FROM reward_events
       WHERE helper_id = $1 AND created_at >= $2 AND created_at < $3`,
      [helperId, dayStart, dayEnd]
    );
    if (helperCountToday.rows[0].count >= config.helperDailyLimit) {
      await client_.query('ROLLBACK');
      return;
    }

    const isOg = helperMember.roles.cache.has(config.ogRoleId);

    if (isOg) {
      const helperRole = await ensureHelperRole(guild);

      if (helperMember.roles.cache.has(helperRole.id)) {
        // Already holds the role — don't double-trigger the MEE6 automation.
        await client_.query(
          `INSERT INTO reward_events
             (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
              channel_id, reward_type, reward_amount, og_status, reward_state)
           VALUES ($1,$2,$3,$4,$5,$6,'action_point',0,true,'flagged_duplicate')
           ON CONFLICT (thank_message_id) DO NOTHING`,
          [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id]
        );
        await client_.query('COMMIT');

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

      const insertResult = await client_.query(
        `INSERT INTO reward_events
           (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
            channel_id, reward_type, reward_amount, og_status, reward_state)
         VALUES ($1,$2,$3,$4,$5,$6,'action_point',$7,true,'completed')
         ON CONFLICT (thank_message_id) DO NOTHING
         RETURNING id`,
        [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id, config.actionPointsPerReward]
      );
      await client_.query('COMMIT');

      if (insertResult.rowCount === 0) return; // lost a race, another path already handled it

      await helperMember.roles.add(helperRole.id, 'Community helper reward — Action Points via MEE6');

      await audit.postActionPointReward(client, {
        guildId: guild.id,
        channelId: thankMessage.channel.id,
        helperId,
        thankerId,
        helpMessageId: helpMessage.id,
        thankMessageId: thankMessage.id,
        amount: config.actionPointsPerReward,
      });
    } else {
      const insertResult = await client_.query(
        `INSERT INTO reward_events
           (guild_id, helper_id, thanker_id, help_message_id, thank_message_id,
            channel_id, reward_type, reward_amount, og_status, reward_state)
         VALUES ($1,$2,$3,$4,$5,$6,'engage_point',$7,false,'pending')
         ON CONFLICT (thank_message_id) DO NOTHING
         RETURNING id`,
        [guild.id, helperId, thankerId, helpMessage.id, thankMessage.id, thankMessage.channel.id, config.engagePointsPerReward]
      );
      await client_.query('COMMIT');

      if (insertResult.rowCount === 0) return;

      await thankMessage.channel.send({
        content:
          `🎉 <@${helperId}> You've been recognized for helping a fellow builder!\n` +
          `You've earned **${config.engagePointsPerReward} Engage Points**.\n` +
          `Your reward is currently pending because Engage Points are awarded manually.\n` +
          `Please tag a moderator to have your ${config.engagePointsPerReward} Engage Points awarded. 🤝`,
      });

      await audit.postPendingEngageReward(client, {
        guildId: guild.id,
        channelId: thankMessage.channel.id,
        helperId,
        thankerId,
        helpMessageId: helpMessage.id,
        thankMessageId: thankMessage.id,
        amount: config.engagePointsPerReward,
      });
    }
  } catch (err) {
    await client_.query('ROLLBACK').catch(() => {});
    console.error('[rewardService] Failed to process thank-you:', err);
  } finally {
    client_.release();
  }
}

module.exports = { tryProcessThankYou };
