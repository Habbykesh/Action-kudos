-- Records every reward event (one row per qualifying thank-you message).
CREATE TABLE IF NOT EXISTS reward_events (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  thanker_id TEXT NOT NULL,
  help_message_id TEXT NOT NULL,
  thank_message_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  reward_type TEXT NOT NULL,       -- 'action_point' | 'engage_point'
  reward_amount INTEGER NOT NULL,
  og_status BOOLEAN NOT NULL,
  reward_state TEXT NOT NULL,      -- 'completed' | 'pending' | 'flagged_duplicate'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_helper_day ON reward_events (helper_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reward_pair_day ON reward_events (helper_id, thanker_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reward_guild ON reward_events (guild_id);

-- Admin-managed appreciation phrases, in addition to the built-in multilingual list.
CREATE TABLE IF NOT EXISTS custom_phrases (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  phrase TEXT NOT NULL,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guild_id, phrase)
);

-- Per-guild bot state: the persistent Helper role id, a heartbeat timestamp
-- used to recover from downtime, and a manual on/off switch (see /rewards).
CREATE TABLE IF NOT EXISTS bot_config (
  guild_id TEXT PRIMARY KEY,
  helper_role_id TEXT,
  last_seen TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT false
);

-- Safe to re-run: adds the column for databases created before this existed.
ALTER TABLE bot_config ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT false;
