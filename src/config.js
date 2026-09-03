require('dotenv').config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function int(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be an integer, got: ${value}`);
  }
  return parsed;
}

function normalizeModelName(raw) {
  if (!raw) return raw;
  let name = raw.trim();
  // Strip surrounding quotes in case they were pasted in by mistake.
  name = name.replace(/^['"]|['"]$/g, '');
  // Google's own error messages say things like "use models/gemini-3.6-flash"
  // — if that whole string gets pasted into the env var, strip the prefix
  // back off so the URL doesn't end up as .../models/models/gemini-3.6-flash.
  name = name.replace(/^models\//, '');
  return name;
}

const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: required('GUILD_ID'),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: (process.env.DATABASE_SSL || 'false').toLowerCase() === 'true',

  auditChannelId: required('AUDIT_CHANNEL_ID'),

  // Universal reward: every AI-verified genuine-help thank-you earns the
  // same amount. The old OG/non-OG split and the Engage Points path are
  // gone — OG_ROLE_ID and ENGAGE_POINTS_PER_REWARD are no longer read.
  actionPointsPerReward: int('ACTION_POINTS_PER_REWARD', 1000),
  helperDailyLimit: int('HELPER_DAILY_LIMIT', 15),
  thankerDailyLimit: int('THANKER_DAILY_LIMIT', 15),
  helpWindowHours: int('HELP_WINDOW_HOURS', 24),
  heartbeatIntervalMs: int('HEARTBEAT_INTERVAL_MS', 30000),

  helperRoleName: 'Helper',

  // ---- AI verification (Gemini) ----
  // Required: without it, tryProcessThankYou can't verify anything and will
  // never reward (see aiVerifier.js — that's the deliberate fail-safe).
  geminiApiKey: required('GEMINI_API_KEY'),
  // gemini-2.5-flash was deprecated for new API keys/projects (Google
  // pointed migrators to gemini-3.6-flash, released July 2026, still on
  // the free tier as of this writing). Override via env if this changes
  // again — Google's free-tier model lineup moves fast.
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  geminiTimeoutMs: int('GEMINI_TIMEOUT_MS', 8000),
  // How many prior messages in the channel to include as extra context when
  // asking the AI to classify a thank-you. Keep this small to conserve
  // free-tier tokens/requests.
  geminiContextMessageCount: int('GEMINI_CONTEXT_MESSAGE_COUNT', 4),
};

module.exports = config;
