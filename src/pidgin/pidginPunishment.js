// Escalation table per-user, per-UTC-day.
// 1st offence: warning only, no punishment.
// 2nd-4th: PO1/PO2/PO3 role -> Action Point deduction.
// 5th-8th: escalating Discord timeouts.
const ESCALATION = {
  1: { type: 'warning', label: 'Warning only — no penalty' },
  2: { type: 'po1', label: '-1,000 Action Points' },
  3: { type: 'po2', label: '-3,000 Action Points' },
  4: { type: 'po3', label: '-10,000 Action Points' },
  5: { type: 'timeout', label: '10-minute timeout', durationMs: 10 * 60 * 1000 },
  6: { type: 'timeout', label: '1-hour timeout', durationMs: 60 * 60 * 1000 },
  7: { type: 'timeout', label: '1-hour timeout', durationMs: 60 * 60 * 1000 },
  8: { type: 'timeout', label: '24-hour timeout', durationMs: 24 * 60 * 60 * 1000 },
};

function getEscalation(offenceNumber) {
  if (ESCALATION[offenceNumber]) return ESCALATION[offenceNumber];
  // Beyond the 8th offence the user is already serving a 24h timeout, but
  // as a safety net fall back to the most severe defined tier.
  return ESCALATION[8];
}

const ROLE_REMOVE_DELAY_MS = 3000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Applies the punishment for a given offence number. The 1st offence is a
 * warning only (no action taken here). For the 2nd-4th (PO1/PO2/PO3), this
 * assigns the role (letting the existing Action Points role automation
 * react to it), waits briefly, then removes the role again — exactly the
 * "Assign -> automation deducts AP -> remove" flow in the spec. For the
 * 5th-8th, it applies a Discord timeout instead.
 */
async function apply({ guild, member, poRoles, offenceNumber, hasSufficientHierarchy }) {
  const escalation = getEscalation(offenceNumber);

  if (escalation.type === 'warning') {
    // 1st offence: no punishment applied, just the warning message + log.
    return { success: true, escalation };
  }

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
