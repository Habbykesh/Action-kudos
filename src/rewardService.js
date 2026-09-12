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
 * already on the message objects. Returns { ok: true } if this pair of
 * messages is even worth considering as a thank-you interaction, or
 * { ok: false, reason } explaining why not.
 */
function passesBasicShape(thankMessage, helpMessage) {
  if (!helpMessage) return { ok: false, reason: 'could not fetch the message being replied to (deleted, or fetch failed)' };
  if (thankMessage.author.bot) return { ok: false, reason: 'thank-you author is a bot' };
  if (helpMessage.author.bot) return { ok: false, reason: 'help message author is a bot' };
  if (helpMessage.author.id === thankMessage.author.id) return { ok: false, reason: "can't thank yourself (same author)" };

  const delta = thankMessage.createdTimestamp - helpMessage.createdTimestamp;
  if (delta < 0) return { ok: false, reason: 'thank-you timestamp is before the help message (out of order)' };
  if (delta > HELP_WINDOW_MS) {
    const hours = (delta / (60 * 60 * 1000)).toFixed(1);
    return { ok: false, reason: `outside the ${config.helpWindowHours}h reply window (this reply came ${hours}h after the help message)` };
  }

  return { ok: true };
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

    // Checked first (cheap, no Discord API call) so the diagnostic logging
    // below only fires for messages that actually look like a thank-you —
    // not every reply sent in the server.
    const matched = await isAppreciation(message.guild.id, message.content);
    if (!matched) return;

    const helpMessage = await message.channel.messages
      .fetch(message.reference.messageId)
      .catch(() => null);

    const shape = passesBasicShape(message, helpMessage);
    if (!shape.ok) {
      console.log(
        `[rewardService] Thank-you phrase matched but skipped — ${shape.reason} ` +
          `(guild=${message.guild.id}, channel=${message.channel.id}, thankMessage=${message.id}, ` +
          `thanker=${message.author.id}, repliedTo=${message.reference.messageId})`
      );
      return;
    }

    await processValidThankYou(client, message, helpMessage);
  } catch (err) {
    console.error('[rewardService] Error while processing potential thank-you:', err);
  }
}

/**
 * All deterministic eligibility checks — cheap, DB/permission based, no AI
 * involved. This runs BEFORE the AI call so a request that would be
 * rejected anyway (duplicate, over a daily cap, etc.) never burns Gemini
 * quota. See spec §9 ("AI Usage Optimization"). Returns { eligible: true }
 * or { eligible: false, reason } explaining which rule blocked it.
 */
async function checkEligibility({ helperId, thankerId, thankMessageId, dayStart, dayEnd }) {
  const already = await pool.query('SELECT 1 FROM reward_events WHERE thank_message_id = $1', [thankMessageId]);
  if (already.rowCount > 0) return { eligible: false, reason: 'this exact message was already processed' };

  const pairToday = await pool.query(
    `SELECT 1 FROM reward_events
     WHERE helper_id = $1 AND thanker_id = $2
       AND created_at >= $3 AND created_at < $4
       AND reward_state = ANY($5)
     LIMIT 1`,
    [helperId, thankerId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (pairToday.rowCount > 0) {
    return { eligible: false, reason: 'this helper+thanker pair already got a reward today (once per pair per UTC day)' };
  }

  const helperCountToday = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reward_events
     WHERE helper_id = $1 AND created_at >= $2 AND created_at < $3 AND reward_state = ANY($4)`,
    [helperId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (helperCountToday.rows[0].count >= config.helperDailyLimit) {
    return { eligible: false, reason: `helper already hit their daily cap (${config.helperDailyLimit}/day)` };
  }

  const thankerCountToday = await pool.query(
    `SELECT COUNT(*)::int AS count FROM reward_events
     WHERE thanker_id = $1 AND created_at >= $2 AND created_at < $3 AND reward_state = ANY($4)`,
    [thankerId, dayStart, dayEnd, COUNTS_TOWARD_LIMITS]
  );
  if (thankerCountToday.rows[0].count >= config.thankerDailyLimit) {
    return { eligible: false, reason: `thanker already hit their daily cap (${config.thankerDailyLimit}/day)` };
  }

  return { eligible: true };
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
  const logCtx = `(guild=${guild.id}, thankMessage=${thankMessage.id}, helper=${helperId}, thanker=${thankerId})`;

  const helperMember = await guild.members.fetch(helperId).catch(() => null);
  if (!helperMember) {
    console.log(`[rewardService] Thank-you skipped — helper is no longer in the server ${logCtx}`);
    return;
  }
  if (helperMember.user.bot) {
    console.log(`[rewardService] Thank-you skipped — helper is a bot ${logCtx}`);
    return;
  }

  // Members with Manage Server are excluded from the automatic reward —
  // helping is already part of their role.
  if (helperMember.permissions.has(PermissionFlagsBits.ManageGuild)) {
    console.log(`[rewardService] Thank-you skipped — helper has Manage Server, exempt from auto-reward ${logCtx}`);
    return;
  }

  const { start: dayStart, end: dayEnd } = utcDayBounds(new Date(thankMessage.createdTimestamp));

  const eligibility = await checkEligibility({
    helperId,
    thankerId,
    thankMessageId: thankMessage.id,
    dayStart,
    dayEnd,
  });
  if (!eligibility.eligible) {
    console.log(`[rewardService] Thank-you skipped — ${eligibility.reason} ${logCtx}`);
    return;
  }

  // ---- AI verification: only reached after every deterministic check
  // above has passed, to conserve free-tier Gemini quota (spec §9). ----
  const contextMessages = await fetchContextMessages(thankMessage.channel, helpMessage);
  const verification = await classifyThankYou({ thankMessage, helpMessage, contextMessages });

  if (!verification) {
    // Timeout, error, invalid/unexpected response, or quota exceeded —
    // never reward on an AI failure. Log it so it can be investigated.
    console.log(`[rewardService] Thank-you skipped — AI verification failed, see [aiVerifier] logs above ${logCtx}`);
    await logNonReward(client, { guild, helperId, thankerId, helpMessage, thankMessage, state: 'ai_failed' });
    return;
  }

  if (verification.classification !== 'GENUINE_HELP') {
    console.log(`[rewardService] Thank-you skipped — AI classified this as PLEASANTRY, not genuine help ${logCtx}`);
    await logNonReward(client, { guild, helperId, thankerId, helpMessage, thankMessage, state: 'ai_rejected' });
    return;
  }

  console.log(`[rewardService] Thank-you verified as GENUINE_HELP — granting reward ${logCtx}`);
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

/**
 * States where AI verification did NOT confirm genuine help — the only
 * states a manual grant is allowed to override. Deliberately excludes
 * 'completed' and 'flagged_duplicate' (already rewarded) and the legacy
 * 'pending' state (not part of this flow).
 */
const OVERRIDABLE_STATES = ['ai_failed', 'ai_rejected'];

/**
 * Lets a moderator manually grant a reward that AI verification failed or
 * rejected — a safety valve for free-tier Gemini limitations (rate limits,
 * "high demand" 503s) that even retries can't always work around. Reuses
 * the exact same Helper-role + MEE6 mechanism as an AI-approved reward, so
 * there's no separate, less-audited reward path.
 *
 * Returns { success: true, helperId, thankerId, amount } or
 * { success: false, error: '<reason code>' }.
 */
async function manualGrantReward(client, { guild, moderatorId, thankMessageId }) {
  const existing = await pool.query(
    'SELECT * FROM reward_events WHERE thank_message_id = $1 AND guild_id = $2',
    [thankMessageId, guild.id]
  );

  if (existing.rowCount === 0) {
    return { success: false, error: 'not_found' };
  }

  const row = existing.rows[0];

  if (!OVERRIDABLE_STATES.includes(row.reward_state)) {
    return { success: false, error: 'not_overridable', currentState: row.reward_state };
  }

  const channel = await guild.channels.fetch(row.channel_id).catch(() => null);
  if (!channel) return { success: false, error: 'channel_not_found' };

  const helperMember = await guild.members.fetch(row.helper_id).catch(() => null);
  if (!helperMember) return { success: false, error: 'helper_not_found' };

  const helperRole = await ensureHelperRole(guild);

  if (helperMember.roles.cache.has(helperRole.id)) {
    // Don't force a re-add — that risks double-triggering MEE6 if the
    // previous assignment's automation hasn't cleared yet. Leave the
    // ai_failed/ai_rejected row as-is so this can be retried shortly.
    return { success: false, error: 'helper_role_already_assigned' };
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    const updateResult = await dbClient.query(
      `UPDATE reward_events
       SET reward_type = 'action_point',
           reward_amount = $1,
           reward_state = 'completed',
           manually_granted_by = $2,
           manually_granted_at = now()
       WHERE thank_message_id = $3 AND reward_state = ANY($4)
       RETURNING id`,
      [config.actionPointsPerReward, moderatorId, thankMessageId, OVERRIDABLE_STATES]
    );
    await dbClient.query('COMMIT');

    if (updateResult.rowCount === 0) {
      // Lost a race — someone else already handled this row since we read it.
      return { success: false, error: 'already_rewarded' };
    }
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('[rewardService] Failed to record manual grant:', err);
    return { success: false, error: 'db_error' };
  } finally {
    dbClient.release();
  }

  await helperMember.roles.add(helperRole.id, `Manually granted by moderator ${moderatorId} (AI verification: ${row.reward_state})`);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎉 Helper Recognized!')
    .setDescription("You've been recognized for helping a fellow builder! (Manually verified by a moderator.)")
    .addFields(
      { name: '🏆 Reward Earned', value: `${config.actionPointsPerReward} Action Points`, inline: true },
      { name: '✅ Status', value: 'Awarded', inline: true },
    )
    .setFooter({ text: 'Keep it up! 🙌' });

  await channel
    .send({ content: `<@${row.helper_id}>`, embeds: [embed] })
    .then((sent) => {
      setTimeout(() => {
        sent.delete().catch(() => {});
      }, REWARD_MESSAGE_DELETE_MS);
    })
    .catch((err) => console.error('[rewardService] Failed to post manual-grant reward message:', err));

  await audit
    .postManualGrantReward(client, {
      guildId: guild.id,
      channelId: row.channel_id,
      helperId: row.helper_id,
      thankerId: row.thanker_id,
      helpMessageId: row.help_message_id,
      thankMessageId: row.thank_message_id,
      amount: config.actionPointsPerReward,
      moderatorId,
      previousState: row.reward_state,
    })
    .catch((err) => console.error('[rewardService] Failed to post manual-grant audit log:', err));

  return { success: true, helperId: row.helper_id, thankerId: row.thanker_id, amount: config.actionPointsPerReward };
}

module.exports = { tryProcessThankYou, manualGrantReward };
