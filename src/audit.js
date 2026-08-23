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

async function postPendingEngageReward(client, { guildId, channelId, helperId, thankerId, helpMessageId, thankMessageId, amount }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xf5c518)
    .setTitle('🟡 ENGAGE POINT REWARD PENDING')
    .addFields(
      { name: 'Helper', value: `<@${helperId}>`, inline: true },
      { name: 'Helped', value: `<@${thankerId}>`, inline: true },
      { name: 'Reward', value: `${amount} Engage Points`, inline: true },
      { name: 'Status', value: 'Pending', inline: true },
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

module.exports = {
  postPendingEngageReward,
  postActionPointReward,
  postDuplicateHelperRoleFlag,
};
