const { EmbedBuilder } = require('discord.js');
const config = require('./config');

function messageLink(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function getAuditChannel(client) {
  const channel = await client.channels.fetch(config.auditChannelId).catch(() => null);
  if (!channel) {
    console.error(`[audit] Could not find audit channel ${config.auditChannelId}`);
  }
  return channel;
}

async function postAiVerificationFailure(client, { guildId, channelId, helperId, thankerId, helpMessageId, thankMessageId }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('⚠️ AI VERIFICATION FAILED — NO REWARD ISSUED')
    .setDescription('The Gemini verification call timed out, errored, or returned an unexpected response. No reward was granted. Review manually if this looks like genuine help.')
    .addFields(
      { name: 'Helper', value: `<@${helperId}>`, inline: true },
      { name: 'Thanker', value: `<@${thankerId}>`, inline: true },
      { name: 'Help Message', value: `[View](${messageLink(guildId, channelId, helpMessageId)})`, inline: true },
      { name: 'Thank-You Message', value: `[View](${messageLink(guildId, channelId, thankMessageId)})`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postActionPointReward(client, { guildId, channelId, helperId, thankerId, helpMessageId, thankMessageId, amount }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🟢 ACTION POINT REWARD GRANTED')
    .addFields(
      { name: 'Helper', value: `<@${helperId}>`, inline: true },
      { name: 'Helped', value: `<@${thankerId}>`, inline: true },
      { name: 'Reward', value: `${amount} Action Points (via Helper role → MEE6)`, inline: true },
      { name: 'Status', value: 'Completed', inline: true },
      { name: 'Help Message', value: `[View](${messageLink(guildId, channelId, helpMessageId)})`, inline: true },
      { name: 'Thank-You Message', value: `[View](${messageLink(guildId, channelId, thankMessageId)})`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postDuplicateHelperRoleFlag(client, { guildId, channelId, helperId, thankerId, helpMessageId, thankMessageId }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🔴 SKIPPED — HELPER ALREADY HAS HELPER ROLE')
    .setDescription('This member already holds the Helper role, so no new reward role was assigned. Please review manually if a reward is still owed.')
    .addFields(
      { name: 'Helper', value: `<@${helperId}>`, inline: true },
      { name: 'Helped', value: `<@${thankerId}>`, inline: true },
      { name: 'Help Message', value: `[View](${messageLink(guildId, channelId, helpMessageId)})`, inline: true },
      { name: 'Thank-You Message', value: `[View](${messageLink(guildId, channelId, thankMessageId)})`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postManualGrantReward(client, { guildId, channelId, helperId, thankerId, helpMessageId, thankMessageId, amount, moderatorId, previousState }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🛠️ REWARD MANUALLY GRANTED (AI verification bypassed)')
    .setDescription(`AI verification previously resulted in \`${previousState}\`. A moderator reviewed it manually and granted the reward.`)
    .addFields(
      { name: 'Helper', value: `<@${helperId}>`, inline: true },
      { name: 'Helped', value: `<@${thankerId}>`, inline: true },
      { name: 'Reward', value: `${amount} Action Points (via Helper role → MEE6)`, inline: true },
      { name: 'Granted by', value: `<@${moderatorId}>`, inline: true },
      { name: 'Help Message', value: `[View](${messageLink(guildId, channelId, helpMessageId)})`, inline: true },
      { name: 'Thank-You Message', value: `[View](${messageLink(guildId, channelId, thankMessageId)})`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

module.exports = {
  postAiVerificationFailure,
  postActionPointReward,
  postDuplicateHelperRoleFlag,
  postManualGrantReward,
  getAuditChannel,
  messageLink,
};
