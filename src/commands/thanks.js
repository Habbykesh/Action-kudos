const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const customPhrases = require('../customPhrases');
const phraseEngine = require('../phraseEngine');

const data = new SlashCommandBuilder()
  .setName('thanks')
  .setDescription('Manage custom appreciation phrases for the helper reward system.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a custom appreciation phrase.')
      .addStringOption((opt) =>
        opt.setName('phrase').setDescription('The phrase to recognize, e.g. "big ups"').setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a custom appreciation phrase.')
      .addStringOption((opt) =>
        opt.setName('phrase').setDescription('The exact phrase to remove').setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('list').setDescription('List all custom appreciation phrases for this server.'));

async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'add') {
    const phrase = interaction.options.getString('phrase', true);
    await customPhrases.addPhrase(guildId, phrase, interaction.user.id);
    phraseEngine.invalidate(guildId);
    await interaction.reply({ content: `✅ Added custom appreciation phrase: \`${phrase.toLowerCase().trim()}\``, ephemeral: true });
    return;
  }

  if (sub === 'remove') {
    const phrase = interaction.options.getString('phrase', true);
    const removed = await customPhrases.removePhrase(guildId, phrase);
    phraseEngine.invalidate(guildId);
    await interaction.reply({
      content: removed
        ? `🗑️ Removed custom appreciation phrase: \`${phrase.toLowerCase().trim()}\``
        : `That phrase wasn't found in the custom list (it may be part of the built-in library instead).`,
      ephemeral: true,
    });
    return;
  }

  if (sub === 'list') {
    const phrases = await customPhrases.getCustomPhrases(guildId);
    const embed = new EmbedBuilder()
      .setTitle('Custom Appreciation Phrases')
      .setDescription(
        phrases.length
          ? phrases.map((p) => `• ${p}`).join('\n').slice(0, 4000)
          : 'No custom phrases have been added yet. This server is using the built-in multilingual library.'
      )
      .setColor(0x5865f2);
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

module.exports = { data, execute };
