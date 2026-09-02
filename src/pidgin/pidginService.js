const { PermissionFlagsBits } = require('discord.js');
const pool = require('../db/pool');
const pidginConfig = require('./pidginConfig');
const dictionaryEngine = require('./dictionaryEngine');
const dailyState = require('./dailyState');
const { ensurePidginRoles, hasSufficientHierarchy } = require('./poRoles');
const pidginPunishment = require('./pidginPunishment');
const pidginAudit = require('./pidginAudit');

const WARNING_DELETE_MS = 30 * 1000;

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

function ordinalize(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/**
 * Entry point — safe to call for every message (create or edit). No-ops
 * quickly whenever Pidgin Enforcement doesn't apply. This function does
 * NOT check whether the Thank-You layer is enabled; the two systems are
 * fully independent per spec §22.
 */
async function processMessage(client, message, { edited = false } = {}) {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (!message.content) return;

    const guildId = message.guild.id;

    const enabled = await pidginConfig.isEnabled(guildId);
    if (!enabled) return;

    const excluded = await pidginConfig.isChannelExcluded(guildId, message.channel.id);
    if (excluded) return;

    const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (!member) return;
    if (member.user.bot) return;
    // Manage Server is exempt — permission-based, not tied to a specific role.
    if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return;

    const matchedTerms = await dictionaryEngine.detect(guildId, message.content);
    if (matchedTerms.length === 0) return;

    await handleOffence(client, message, member, matchedTerms, edited);
  } catch (err) {
    console.error('[pidginService] Error while processing message:', err);
  }
}

async function handleOffence(client, message, member, matchedTerms, edited) {
  const guild = message.guild;
  const guildId = guild.id;
  const now = new Date();
  const { start: dayStart, end: dayEnd } = dailyState.utcDayBounds(now);

  let offenceNumber = null;
  let escalation = null;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    // Serialize per user/guild so concurrent events (e.g. an edit landing
    // right after the original create event) can't race into duplicate or
    // out-of-order offence numbers. The message_id UNIQUE constraint below
    // is still the ultimate duplicate guard.
    await dbClient.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${guildId}:${member.id}`]);

    const already = await dbClient.query('SELECT 1 FROM pidgin_offences WHERE message_id = $1', [message.id]);
    if (already.rowCount > 0) {
      await dbClient.query('ROLLBACK');
      return; // this exact message already produced an offence
    }

    const lastReset = await dailyState.getLastManualResetToday(dbClient, guildId, member.id, dayStart, dayEnd);
    const countSince = lastReset || dayStart;
    const priorCount = await dailyState.countOffencesSince(dbClient, guildId, member.id, countSince, dayEnd);
    offenceNumber = priorCount + 1;
    escalation = pidginPunishment.getEscalation(offenceNumber);

    await dbClient.query(
      `INSERT INTO pidgin_offences
         (guild_id, user_id, message_id, channel_id, detected_terms, message_content,
          offence_number, penalty_type, penalty_detail, action_success, was_edited, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        guildId, member.id, message.id, message.channel.id, matchedTerms,
        (message.content || '').slice(0, 3800), offenceNumber, escalation.type,
        escalation.label, true, edited, now,
      ]
    );

    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('[pidginService] Failed to record offence:', err);
    return;
  } finally {
    dbClient.release();
  }

  // Punishment is applied after the offence is durably recorded, so a
  // failure here never loses the record (spec §19: "never silently fail").
  let poRoles = null;
  if (escalation.type !== 'timeout') {
    poRoles = await ensurePidginRoles(guild).catch((err) => {
      console.error('[pidginService] Failed to ensure PO roles:', err);
      return null;
    });
  }

  const actionResult = await pidginPunishment.apply({
    guild, member, poRoles, offenceNumber, hasSufficientHierarchy,
  });

  if (!actionResult.success) {
    await pool
      .query('UPDATE pidgin_offences SET action_success = false, failure_reason = $1 WHERE message_id = $2', [
        String(actionResult.error?.message || 'Unknown error'),
        message.id,
      ])
      .catch((err) => console.error('[pidginService] Failed to record action failure:', err));

    await pidginAudit.postActionFailure(client, {
      guildId,
      userId: member.id,
      offenceNumber,
      expectedAction: `${escalation.type.toUpperCase()} / ${escalation.label}`,
      reason: actionResult.error?.message || 'Unknown error',
    });
  }

  await sendWarning(message, member, offenceNumber, escalation);

  await pidginAudit.postOffence(client, {
    guildId,
    channelId: message.channel.id,
    userId: member.id,
    offenceNumber,
    detectedTerms: matchedTerms,
    messageContent: message.content,
    messageId: message.id,
    penaltyLabel: escalation.label,
    wasEdited: edited,
    actionSucceeded: actionResult.success,
    timestamp: now,
  }).catch((err) => console.error('[pidginService] Failed to post offence audit log:', err));
}

async function sendWarning(message, member, offenceNumber, escalation) {
  const content = [
    '⚠️ Pidgin detected!',
    '',
    `<@${member.id}>, this is your ${ordinalize(offenceNumber)} offence today.`,
    '',
    `Penalty: ${escalation.label}.`,
    '',
    'Please use English in this server.',
  ].join('\n');

  try {
    const sent = await message.channel.send({ content });
    setTimeout(() => {
      sent.delete().catch(() => {});
    }, WARNING_DELETE_MS);
  } catch (err) {
    console.error('[pidginService] Failed to send warning message:', err);
  }
}

module.exports = { processMessage, messageLink };
