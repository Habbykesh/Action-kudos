const config = require('./config');
const botConfig = require('./botConfig');

async function ensureHelperRole(guild) {
  const storedId = await botConfig.getHelperRoleId(guild.id);

  if (storedId) {
    const existing = guild.roles.cache.get(storedId) || (await guild.roles.fetch(storedId).catch(() => null));
    if (existing) return existing;
    // Stored role was deleted from Discord — fall through and recreate.
  }

  // Also check by name in case it exists but wasn't recorded (e.g. first run
  // after manual creation), to avoid creating duplicates.
  const byName = guild.roles.cache.find((r) => r.name === config.helperRoleName);
  if (byName) {
    await botConfig.setHelperRoleId(guild.id, byName.id);
    return byName;
  }

  const created = await guild.roles.create({
    name: config.helperRoleName,
    mentionable: false,
    hoist: false,
    reason: 'Auto-created by the community helper reward system.',
  });
  await botConfig.setHelperRoleId(guild.id, created.id);
  console.log(`[helperRole] Created Helper role (${created.id}) in guild ${guild.id}`);
  return created;
}

module.exports = { ensureHelperRole };
