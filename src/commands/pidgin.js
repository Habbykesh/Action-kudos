const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const pidginConfig = require('../pidgin/pidginConfig');
const customTerms = require('../pidgin/customTerms');
const dictionaryEngine = require('../pidgin/dictionaryEngine');
const pidginAudit = require('../pidgin/pidginAudit');
const dailyState = require('../pidgin/dailyState');
const pool = require('../db/pool');
const { ensurePidginRoles } = require('../pidgin/poRoles');
const { getEscalation } = require('../pidgin/pidginPunishment');
const { BASE_TERMS } = require('../pidgin/dictionary');

const data = new SlashCommandBuilder()
  .setName('pidgin')
  .setDescription('Manage the Pidgin Enforcement Layer for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('on').setDescription('Turn Pidgin Enforcement on.'))
  .addSubcommand((sub) => sub.setName('off').setDescription('Turn Pidgin Enforcement off.'))
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a word or phrase to the Pidgin dictionary.')
      .addStringOption((opt) =>
        opt.setName('term').setDescription('e.g. "abeg" or "no wahala"').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a word or phrase from the Pidgin dictionary.')
      .addStringOption((opt) => opt.setName('term').setDescription('The exact word or phrase to remove').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List custom Pidgin dictionary entries for this server.'))
  .addSubcommand((sub) =>
    sub
      .setName('reset')
      .setDescription("Reset a user's current-day offence count. Historical records are kept.")
      .addUserOption((opt) => opt.setName('user').setDescription('The user to reset').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('resetall')
      .setDescription("Reset EVERY member's current-day offence count for this server. Historical records are kept.")
      .addBooleanOption((opt) =>
        opt.setName('confirm').setDescription('Set true to confirm this server-wide reset').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('streak')
      .setDescription("Check a user's current offence count for today.")
      .addUserOption((opt) => opt.setName('user').setDescription('The user to check').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('settings').setDescription('View the current Pidgin Enforcement configuration.'))
  .addSubcommandGroup((group) =>
    group
      .setName('channels')
      .setDescription('Configure which channels Pidgin Enforcement applies to.')
      .addSubcommand((sub) => sub.setName('list').setDescription('List channels excluded from enforcement.'))
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Re-include a channel in Pidgin Enforcement (removes it from the exclusion list).')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('The channel to include')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Exclude a channel from Pidgin Enforcement.')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('The channel to exclude')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
      )
  );

async function execute(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (group === 'channels') {
    return executeChannels(interaction, sub, guildId);
  }

  switch (sub) {
    case 'on':
      return executeOn(interaction, guildId);
    case 'off':
      return executeOff(interaction, guildId);
    case 'add':
      return executeAdd(interaction, guildId);
    case 'remove':
      return executeRemove(interaction, guildId);
    case 'list':
      return executeList(interaction, guildId);
    case 'reset':
      return executeReset(interaction, guildId);
    case 'resetall':
      return executeResetAll(interaction, guildId);
    case 'streak':
      return executeStreak(interaction, guildId);
    case 'settings':
      return executeSettings(interaction, guildId);
    default:
      return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  }
}

async function executeOn(interaction, guildId) {
  await pidginConfig.setEnabled(guildId, true);
  await ensurePidginRoles(interaction.guild).catch((err) => {
    console.error('[pidgin command] Failed to ensure PO roles on enable:', err);
  });
  await pidginAudit.postEnforcementToggle(interaction.client, { actorId: interaction.user.id, enabled: true });
  await interaction.reply({
    content: '✅ Pidgin Enforcement is now **ON**. This is independent of the Thank-You system.',
    ephemeral: true,
  });
}

async function executeOff(interaction, guildId) {
  await pidginConfig.setEnabled(guildId, false);
  await pidginAudit.postEnforcementToggle(interaction.client, { actorId: interaction.user.id, enabled: false });
  await interaction.reply({
    content: '🛑 Pidgin Enforcement is now **OFF**. Messages will no longer be scanned for Pidgin terms.',
    ephemeral: true,
  });
}

async function executeAdd(interaction, guildId) {
  const term = interaction.options.getString('term', true);
  await customTerms.addTerm(guildId, term, interaction.user.id);
  dictionaryEngine.invalidate(guildId);
  await pidginAudit.postDictionaryChange(interaction.client, {
    actorId: interaction.user.id,
    action: 'added',
    term: term.toLowerCase().trim(),
  });
  await interaction.reply({ content: `✅ Added Pidgin term: \`${term.toLowerCase().trim()}\``, ephemeral: true });
}

async function executeRemove(interaction, guildId) {
  const term = interaction.options.getString('term', true);
  const removed = await customTerms.removeTerm(guildId, term);
  dictionaryEngine.invalidate(guildId);
  if (removed) {
    await pidginAudit.postDictionaryChange(interaction.client, {
      actorId: interaction.user.id,
      action: 'removed',
      term: term.toLowerCase().trim(),
    });
  }
  await interaction.reply({
    content: removed
      ? `🗑️ Removed Pidgin term: \`${term.toLowerCase().trim()}\``
      : "That term wasn't found in the custom list (it may be part of the built-in base dictionary instead).",
    ephemeral: true,
  });
}

async function executeList(interaction, guildId) {
  const custom = await customTerms.getCustomTerms(guildId);
  const embed = new EmbedBuilder()
    .setTitle('Custom Pidgin Dictionary Entries')
    .setDescription(
      custom.length
        ? custom.map((t) => `• ${t}`).join('\n').slice(0, 4000)
        : 'No custom terms added yet. This server is using only the built-in base dictionary.'
    )
    .addFields({ name: 'Base dictionary', value: BASE_TERMS.map((t) => `\`${t}\``).join(', ') })
    .setColor(0x5865f2);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeReset(interaction, guildId) {
  const user = interaction.options.getUser('user', true);

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dailyState.recordManualReset(dbClient, guildId, user.id, interaction.user.id);
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('[pidgin command] Failed to record manual reset:', err);
    await interaction.reply({ content: 'Something went wrong recording that reset.', ephemeral: true });
    return;
  } finally {
    dbClient.release();
  }

  await pidginAudit.postManualReset(interaction.client, { userId: user.id, resetBy: interaction.user.id });
  await interaction.reply({
    content: `♻️ Reset <@${user.id}>'s active offence count for today back to 0. Historical records were kept.`,
    ephemeral: true,
  });
}

async function executeResetAll(interaction, guildId) {
  const confirm = interaction.options.getBoolean('confirm', true);
  if (!confirm) {
    await interaction.reply({
      content: 'Cancelled — run `/pidgin resetall confirm:true` if you meant to reset every member\'s streak for today.',
      ephemeral: true,
    });
    return;
  }

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');
    await dailyState.recordGuildReset(dbClient, guildId, interaction.user.id);
    await dbClient.query('COMMIT');
  } catch (err) {
    await dbClient.query('ROLLBACK').catch(() => {});
    console.error('[pidgin command] Failed to record guild-wide reset:', err);
    await interaction.reply({ content: 'Something went wrong recording that reset.', ephemeral: true });
    return;
  } finally {
    dbClient.release();
  }

  await pidginAudit.postGuildReset(interaction.client, { resetBy: interaction.user.id });
  await interaction.reply({
    content: "♻️ Reset **every member's** active offence count for today back to 0. Historical records were kept.",
    ephemeral: true,
  });
}

async function executeStreak(interaction, guildId) {
  const user = interaction.options.getUser('user', true);
  const { count } = await dailyState.getCurrentStreak(pool, guildId, user.id);

  if (count === 0) {
    await interaction.reply({ content: `<@${user.id}> has **no offences** recorded today.`, ephemeral: true });
    return;
  }

  const next = getEscalation(count + 1);
  await interaction.reply({
    content:
      `<@${user.id}> is currently at **${count}** offence${count === 1 ? '' : 's'} today.\n` +
      `Their next offence (#${count + 1}) would trigger: **${next.label}**.`,
    ephemeral: true,
  });
}

async function executeSettings(interaction, guildId) {
  const enabled = await pidginConfig.isEnabled(guildId);
  const excluded = await pidginConfig.getExcludedChannels(guildId);
  const termCount = await dictionaryEngine.countConfiguredTerms(guildId);

  const excludedText = excluded.length ? excluded.map((id) => `<#${id}>`).join(', ') : 'None';

  const embed = new EmbedBuilder()
    .setTitle('Pidgin Enforcement Settings')
    .setColor(0x5865f2)
    .addFields(
      { name: 'Enforcement status', value: enabled ? '✅ ON' : '🛑 OFF', inline: true },
      { name: 'Channel scope', value: 'Server-wide (excluding channels below)', inline: true },
      { name: 'Excluded channels', value: excludedText, inline: false },
      { name: 'Configured detection terms', value: String(termCount), inline: true },
      {
        name: 'Punishment structure',
        value:
          '1st: Warning only\n' +
          '2nd: PO1 → -1,000 AP\n' +
          '3rd: PO2 → -3,000 AP\n' +
          '4th: PO3 → -10,000 AP\n' +
          '5th: 10-minute timeout\n' +
          '6th: 1-hour timeout\n' +
          '7th: 1-hour timeout\n' +
          '8th: 24-hour timeout',
        inline: false,
      },
      { name: 'Daily reset', value: 'Every day at 00:00 UTC (active count only — history is kept forever)', inline: false }
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function executeChannels(interaction, sub, guildId) {
  if (sub === 'list') {
    const excluded = await pidginConfig.getExcludedChannels(guildId);
    await interaction.reply({
      content: excluded.length
        ? `Pidgin Enforcement applies server-wide, **except**: ${excluded.map((id) => `<#${id}>`).join(', ')}`
        : 'Pidgin Enforcement currently applies to **every channel** in this server. No exclusions configured.',
      ephemeral: true,
    });
    return;
  }

  const channel = interaction.options.getChannel('channel', true);

  if (sub === 'add') {
    const changed = await pidginConfig.includeChannel(guildId, channel.id);
    if (changed) {
      await pidginAudit.postChannelConfigChange(interaction.client, {
        actorId: interaction.user.id,
        action: 'included',
        channelId: channel.id,
      });
    }
    await interaction.reply({
      content: changed
        ? `✅ <#${channel.id}> is now included in Pidgin Enforcement.`
        : `<#${channel.id}> was already included (not previously excluded).`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'remove') {
    const changed = await pidginConfig.excludeChannel(guildId, channel.id, interaction.user.id);
    if (changed) {
      await pidginAudit.postChannelConfigChange(interaction.client, {
        actorId: interaction.user.id,
        action: 'excluded',
        channelId: channel.id,
      });
    }
    await interaction.reply({
      content: changed
        ? `🚫 <#${channel.id}> is now excluded from Pidgin Enforcement.`
        : `<#${channel.id}> was already excluded.`,
      ephemeral: true,
    });
  }
}

module.exports = { data, execute };
