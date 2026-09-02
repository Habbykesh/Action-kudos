const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const config = require('./config');
const migrate = require('./db/migrate');
const botConfig = require('./botConfig');
const { ensureHelperRole } = require('./helperRole');
const { recoverGuild } = require('./recovery');
const { tryProcessThankYou } = require('./rewardService');
const thanksCommand = require('./commands/thanks');
const rewardsCommand = require('./commands/rewards');
const pidginCommand = require('./commands/pidgin');
const pidginConfig = require('./pidgin/pidginConfig');
const { ensurePidginRoles } = require('./pidgin/poRoles');
const pidginService = require('./pidgin/pidginService');

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
client.commands.set(rewardsCommand.data.name, rewardsCommand);
client.commands.set(pidginCommand.data.name, pidginCommand);

let heartbeatTimer = null;

client.once('ready', async () => {
  console.log(`[bot] Logged in as ${client.user.tag}`);

  await migrate();

  const guild = await client.guilds.fetch(config.guildId);
  await botConfig.ensureGuildRow(guild.id);
  await ensureHelperRole(guild);

  // Pidgin Enforcement Layer setup — independent of the Thank-You layer
  // above. Its config row and PO roles are ensured regardless of whether
  // enforcement is currently toggled on.
  await pidginConfig.ensureGuildRow(guild.id);
  await ensurePidginRoles(guild).catch((err) => {
    console.error('[bot] Failed to ensure Pidgin PO roles at startup:', err);
  });

  await recoverGuild(client, guild);

  heartbeatTimer = setInterval(() => {
    botConfig.updateLastSeen(guild.id).catch((err) => {
      console.error('[heartbeat] Failed to update last_seen:', err);
    });
  }, config.heartbeatIntervalMs);

  console.log('[bot] Ready and listening for thank-you messages and Pidgin Enforcement.');
});

client.on('messageCreate', (message) => {
  // The Thank-You Recognition Layer and Pidgin Enforcement Layer are fully
  // independent: each checks its own enabled flag internally, and neither
  // one's toggle state affects whether the other runs.
  tryProcessThankYou(client, message);
  pidginService.processMessage(client, message);
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  try {
    const full = newMessage.partial ? await newMessage.fetch() : newMessage;
    await pidginService.processMessage(client, full, { edited: true });
  } catch (err) {
    console.error('[bot] Failed to process edited message for Pidgin Enforcement:', err);
  }
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
