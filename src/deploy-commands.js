const { REST, Routes } = require('discord.js');
const config = require('./config');
const thanksCommand = require('./commands/thanks');

const commands = [thanksCommand.data.toJSON()];

const rest = new REST({ version: '10' }).setToken(config.discordToken);

(async () => {
  try {
    console.log(`Registering ${commands.length} guild command(s) for guild ${config.guildId}...`);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log('Successfully registered guild commands.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
