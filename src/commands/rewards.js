const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const systemState = require('../systemState');

const data = new SlashCommandBuilder()
  .setName('rewards')
  .setDescription('Turn the helper reward system on or off for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('enable').setDescription('Turn the helper reward system on.'))
  .addSubcommand((sub) =>
    sub.setName('disable').setDescription('Turn the helper reward system off. Thank-yous will be ignored, not queued.')
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Check whether the system is currently on or off.'));

async function execute(interaction) {
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();

  if (sub === 'enable') {
    await systemState.setEnabled(guildId, true);
    await interaction.reply({
      content: '✅ The helper reward system is now **ON**. Thank-you messages will be detected and rewarded starting now.',
      ephemeral: true,
    });
    return;
  }

  if (sub === 'disable') {
    await systemState.setEnabled(guildId, false);
    await interaction.reply({
      content: "🛑 The helper reward system is now **OFF**. Thank-you messages will be ignored — not queued — until you run `/rewards enable`.",
      ephemeral: true,
    });
    return;
  }

  if (sub === 'status') {
    const enabled = await systemState.isEnabled(guildId);
    await interaction.reply({
      content: enabled ? '✅ The system is currently **ON**.' : '🛑 The system is currently **OFF**.',
      ephemeral: true,
    });
  }
}

module.exports = { data, execute };
