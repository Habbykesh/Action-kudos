// Escalation table per spec §10/§12. Offences are per-user, per-UTC-day.
const ESCALATION = {
  1: { type: 'po1', label: '-1,000 Action Points' },
  2: { type: 'po2', label: '-3,000 Action Points' },
  3: { type: 'po3', label: '-10,000 Action Points' },
  4: { type: 'timeout', label: '10-minute timeout', durationMs: 10 * 60 * 1000 },
  5: { type: 'timeout', label: '1-hour timeout', durationMs: 60 * 60 * 1000 },
  6: { type: 'timeout', label: '1-hour timeout', durationMs: 60 * 60 * 1000 },
  7: { type: 'timeout', label: '24-hour timeout', durationMs: 24 * 60 * 60 * 1000 },
};

function getEscalation(offenceNumber) {
  if (ESCALATION[offenceNumber]) return ESCALATION[offenceNumber];
  // The spec notes no 8th-offence tier is needed since the user is already
  // serving a 24h timeout by then. As a safety net in case this is ever
  // reached anyway (e.g. a timeout failed to apply), fall back to the
  // most severe defined tier rather than doing nothing.
  return ESCALATION[7];
}

const ROLE_REMOVE_DELAY_MS = 3000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Applies the punishment for a given offence number. For PO1/PO2/PO3,
 * this assigns the role (letting the existing Action Points role
 * automation react to it), waits briefly, then removes the role again —
 * exactly the "Assign -> automation deducts AP -> remove" flow in the
 * spec. For offences 4-7, it applies a Discord timeout instead.
 */
async function apply({ guild, member, poRoles, offenceNumber, hasSufficientHierarchy }) {
  const escalation = getEscalation(offenceNumber);

  if (escalation.type === 'timeout') {
    try {
      await member.timeout(escalation.durationMs, `Pidgin offence #${offenceNumber}`);
      return { success: true, escalation };
    } catch (err) {
      return { success: false, escalation, error: err };
    }
  }

  const role = poRoles?.[escalation.type];
  if (!role) {
    return { success: false, escalation, error: new Error(`${escalation.type.toUpperCase()} role is not available`) };
  }
  if (!hasSufficientHierarchy(guild, role)) {
    return {
      success: false,
      escalation,
      error: new Error(`Bot's highest role is not above ${role.name} — cannot assign it`),
    };
  }

  try {
    await member.roles.add(role.id, `Pidgin offence #${offenceNumber}`);
    await delay(ROLE_REMOVE_DELAY_MS);
    await member.roles
      .remove(role.id, `Pidgin offence #${offenceNumber} — automation trigger complete`)
      .catch((err) => {
        console.error(`[pidginPunishment] Assigned ${role.name} but failed to remove it afterward:`, err);
      });
    return { success: true, escalation };
  } catch (err) {
    return { success: false, escalation, error: err };
  }
}

module.exports = { getEscalation, apply };
