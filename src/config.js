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

const config = {
  discordToken: required('DISCORD_TOKEN'),
  clientId: required('CLIENT_ID'),
  guildId: required('GUILD_ID'),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: (process.env.DATABASE_SSL || 'false').toLowerCase() === 'true',

  ogRoleId: required('OG_ROLE_ID'),
  auditChannelId: required('AUDIT_CHANNEL_ID'),

  actionPointsPerReward: int('ACTION_POINTS_PER_REWARD', 1000),
  engagePointsPerReward: int('ENGAGE_POINTS_PER_REWARD', 100),
  helperDailyLimit: int('HELPER_DAILY_LIMIT', 15),
  thankerDailyLimit: int('THANKER_DAILY_LIMIT', 5),
  thankerDailyLimit: int('THANKER_DAILY_LIMIT', 15),
  helpWindowHours: int('HELP_WINDOW_HOURS', 24),
  heartbeatIntervalMs: int('HEARTBEAT_INTERVAL_MS', 30000),

  helperRoleName: 'Helper',
};

module.exports = config;
