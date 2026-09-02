const pidginConfig = require('./pidginConfig');

const ROLE_DEFS = [
  { key: 'po1', name: 'PO1' },
  { key: 'po2', name: 'PO2' },
  { key: 'po3', name: 'PO3' },
];

async function resolveRole(guild, def, storedId) {
  if (storedId) {
    const existing = guild.roles.cache.get(storedId) || (await guild.roles.fetch(storedId).catch(() => null));
    if (existing) return existing;
    // Stored role was deleted from Discord — fall through and recreate.
  }

  // Also check by name in case it exists but wasn't recorded, to avoid
  // creating duplicates (e.g. it was created manually before this ran).
  const byName = guild.roles.cache.find((r) => r.name === def.name);
  if (byName) return byName;

  return guild.roles.create({
    name: def.name,
    mentionable: false,
    hoist: false,
    reason: 'Auto-created by the Pidgin Enforcement Layer for Action Points automation.',
  });
}

/**
 * Ensures PO1/PO2/PO3 exist in the guild, creating any that are missing,
 * and persists their role IDs so future lookups don't depend on role
 * names. Returns { po1, po2, po3 } as Discord Role objects.
 */
async function ensurePidginRoles(guild) {
  const stored = await pidginConfig.getPoRoleIds(guild.id);
  const result = {};
  let changed = false;

  for (const def of ROLE_DEFS) {
    const storedId = stored[`${def.key}RoleId`];
    const role = await resolveRole(guild, def, storedId);
    result[def.key] = role;
    if (storedId !== role.id) changed = true;
  }

  if (changed) {
    await pidginConfig.setPoRoleIds(guild.id, {
      po1: result.po1.id,
      po2: result.po2.id,
      po3: result.po3.id,
    });
  }

  return result;
}

/**
 * Discord won't let a bot assign/manage a role positioned at or above its
 * own highest role. Check this before attempting the assignment so a
 * failure can be logged clearly instead of surfacing as a raw API error.
 */
function hasSufficientHierarchy(guild, role) {
  const me = guild.members.me;
  if (!me) return false;
  return me.roles.highest.position > role.position;
}

module.exports = { ensurePidginRoles, hasSufficientHierarchy };
