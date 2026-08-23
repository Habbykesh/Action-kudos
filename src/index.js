const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const migrate = require('./db/migrate');
const botConfig = require('./botConfig');
const { ensureHelperRole } = require('./helperRole');
const { recoverGuild } = require('./recovery');
const { tryProcessThankYou } = require('./rewardService');
const thanksCommand = require('./commands/thanks');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.commands = new Collection();
client.commands.set(thanksCommand.data.name, thanksCommand);

let heartbeatTimer = null;

client.once('ready', async () => {
  console.log(`[bot] Logged in as ${client.user.tag}`);

  await migrate();

  const guild = await client.guilds.fetch(config.guildId);
  await botConfig.ensureGuildRow(guild.id);
  await ensureHelperRole(guild);

  await recoverGuild(client, guild);

  heartbeatTimer = setInterval(() => {
    botConfig.updateLastSeen(guild.id).catch((err) => {
      console.error('[heartbeat] Failed to update last_seen:', err);
    });
  }, config.heartbeatIntervalMs);

  console.log('[bot] Ready and listening for thank-you messages.');
});

client.on('messageCreate', (message) => {
  tryProcessThankYou(client, message);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[commands] Error executing /${interaction.commandName}:`, err);
    const payload = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

async function shutdown(signal) {
  console.log(`[bot] Received ${signal}, shutting down gracefully...`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  try {
    if (client.guilds.cache.has(config.guildId)) {
      await botConfig.updateLastSeen(config.guildId, new Date());
    }
  } catch (err) {
    console.error('[bot] Failed to record final heartbeat on shutdown:', err);
  }
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken);
