const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const systemState = require('../systemState');
const { manualGrantReward } = require('../rewardService');

const data = new SlashCommandBuilder()
  .setName('rewards')
  .setDescription('Turn the helper reward system on or off for this server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('enable').setDescription('Turn the helper reward system on.'))
  .addSubcommand((sub) =>
    sub.setName('disable').setDescription('Turn the helper reward system off. Thank-yous will be ignored, not queued.')
  )
  .addSubcommand((sub) => sub.setName('status').setDescription('Check whether the system is currently on or off.'))
  .addSubcommand((sub) =>
    sub
      .setName('grant')
      .setDescription('Manually grant a reward that AI verification failed or rejected in error.')
      .addStringOption((opt) =>
        opt
          .setName('message')
          .setDescription('The thank-you message ID or link (find it in the audit channel entry)')
          .setRequired(true)
      )
  );

function extractMessageId(input) {
  const trimmed = input.trim();
  const linkMatch = trimmed.match(/\/channels\/\d+\/\d+\/(\d{17,20})/);
  if (linkMatch) return linkMatch[1];
  const bareMatch = trimmed.match(/^\d{17,20}$/);
  if (bareMatch) return bareMatch[0];
  return null;
}

const GRANT_ERROR_MESSAGES = {
  not_found: "No reward record found for that message. Double check the message ID/link — it should be the thank-you message's, from the audit log entry.",
  not_overridable: (currentState) =>
    currentState === 'completed' || currentState === 'flagged_duplicate'
      ? 'This thank-you was already rewarded — nothing to grant.'
      : `This record is in state \`${currentState}\`, which isn't something \`/rewards grant\` can override.`,
  channel_not_found: "Couldn't find the original channel — it may have been deleted.",
  helper_not_found: 'The helper is no longer in this server, so the reward role can\'t be assigned.',
  helper_role_already_assigned:
    'The helper currently holds the Helper role already (likely from a pending MEE6 automation run). Wait a moment for it to clear, then try again — granting now risks a double reward.',
  already_rewarded: 'This was just rewarded (possibly by another moderator at the same moment) — nothing more to do.',
  db_error: 'Something went wrong recording this in the database. Check the logs and try again.',
};

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
    return;
  }

  if (sub === 'grant') {
    const rawInput = interaction.options.getString('message', true);
    const thankMessageId = extractMessageId(rawInput);

    if (!thankMessageId) {
      await interaction.reply({
        content: "That doesn't look like a valid message ID or Discord message link. Copy either the ID or the full link from the audit channel entry.",
        ephemeral: true,
      });
      return;
    }

    const result = await manualGrantReward(interaction.client, {
      guild: interaction.guild,
      moderatorId: interaction.user.id,
      thankMessageId,
    });

    if (result.success) {
      await interaction.reply({
        content: `✅ Granted ${result.amount} Action Points to <@${result.helperId}> for helping <@${result.thankerId}>. Logged to the audit channel.`,
        ephemeral: true,
      });
      return;
    }

    const messageBuilder = GRANT_ERROR_MESSAGES[result.error];
    const errorMessage = typeof messageBuilder === 'function' ? messageBuilder(result.currentState) : messageBuilder;
    await interaction.reply({
      content: `❌ ${errorMessage || 'Something went wrong granting this reward.'}`,
      ephemeral: true,
    });
  }
}

module.exports = { data, execute };
