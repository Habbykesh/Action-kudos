const { EmbedBuilder } = require('discord.js');
const { getAuditChannel, messageLink } = require('../audit');

async function postOffence(client, {
  guildId, channelId, userId, offenceNumber, detectedTerms, messageContent,
  messageId, penaltyLabel, wasEdited, actionSucceeded, timestamp,
}) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(actionSucceeded ? 0xed8f24 : 0xed4245)
    .setTitle('🗣️ Pidgin Offence')
    .addFields(
      { name: 'User', value: `<@${userId}>`, inline: true },
      { name: 'User ID', value: userId, inline: true },
      { name: 'Offence', value: `#${offenceNumber}`, inline: true },
      { name: 'Detected', value: detectedTerms.map((t) => `\`${t}\``).join(', ').slice(0, 1024) || '—', inline: false },
      { name: 'Penalty', value: penaltyLabel, inline: true },
      { name: 'Edited message', value: wasEdited ? 'Yes' : 'No', inline: true },
      { name: 'Action taken', value: actionSucceeded ? 'Applied' : 'Failed (see failure log)', inline: true },
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'Message', value: `[Jump to message](${messageLink(guildId, channelId, messageId)})`, inline: true },
      { name: 'Original content', value: (messageContent || '—').slice(0, 1000), inline: false },
    )
    .setTimestamp(timestamp || new Date());

  await channel.send({ embeds: [embed] });
}

async function postActionFailure(client, { guildId, userId, offenceNumber, expectedAction, reason }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('❌ Pidgin enforcement action failed')
    .addFields(
      { name: 'User', value: `<@${userId}>`, inline: true },
      { name: 'Offence', value: `#${offenceNumber}`, inline: true },
      { name: 'Expected action', value: expectedAction, inline: true },
      { name: 'Reason', value: reason || 'Unknown error', inline: false },
      { name: 'Note', value: 'The offence was still recorded even though the enforcement action failed.', inline: false },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postManualReset(client, { userId, resetBy }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('♻️ Pidgin offence count manually reset')
    .addFields(
      { name: 'User', value: `<@${userId}>`, inline: true },
      { name: 'Reset by', value: `<@${resetBy}>`, inline: true },
      { name: 'Note', value: "Today's active offence count was reset to 0. Historical offence records were not deleted.", inline: false },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postDictionaryChange(client, { actorId, action, term }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(action === 'added' ? '➕ Pidgin term added' : '➖ Pidgin term removed')
    .addFields(
      { name: 'Term', value: `\`${term}\``, inline: true },
      { name: 'By', value: `<@${actorId}>`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postEnforcementToggle(client, { actorId, enabled }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(enabled ? 0x57f287 : 0x99aab5)
    .setTitle(enabled ? '✅ Pidgin Enforcement turned ON' : '🛑 Pidgin Enforcement turned OFF')
    .addFields({ name: 'By', value: `<@${actorId}>`, inline: true })
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postChannelConfigChange(client, { actorId, action, channelId }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(action === 'excluded' ? '🚫 Channel excluded from Pidgin Enforcement' : '✅ Channel included in Pidgin Enforcement')
    .addFields(
      { name: 'Channel', value: `<#${channelId}>`, inline: true },
      { name: 'By', value: `<@${actorId}>`, inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

async function postRolesCreated(client, { roles }) {
  const channel = await getAuditChannel(client);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Pidgin PO roles created')
    .setDescription('One or more of PO1/PO2/PO3 did not exist and were auto-created.')
    .addFields(
      { name: 'PO1', value: roles.po1 ? `<@&${roles.po1.id}>` : '—', inline: true },
      { name: 'PO2', value: roles.po2 ? `<@&${roles.po2.id}>` : '—', inline: true },
      { name: 'PO3', value: roles.po3 ? `<@&${roles.po3.id}>` : '—', inline: true },
    )
    .setTimestamp(new Date());

  await channel.send({ embeds: [embed] });
}

module.exports = {
  postOffence,
  postActionFailure,
  postManualReset,
  postDictionaryChange,
  postEnforcementToggle,
  postChannelConfigChange,
  postRolesCreated,
};
