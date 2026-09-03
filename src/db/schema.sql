-- Records every reward event, and now also every AI-verification outcome
-- (even non-rewards) so nothing about the Thank-You pipeline is silently
-- lost — see rewardService.js / aiVerifier.js.
CREATE TABLE IF NOT EXISTS reward_events (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  helper_id TEXT NOT NULL,
  thanker_id TEXT NOT NULL,
  help_message_id TEXT NOT NULL,
  thank_message_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  reward_type TEXT NOT NULL,       -- 'action_point' | 'engage_point' (legacy, no longer generated) | 'none' (ai_rejected/ai_failed rows)
  reward_amount INTEGER NOT NULL,
  og_status BOOLEAN NOT NULL,      -- vestigial: the OG/non-OG split was removed; always true now
  reward_state TEXT NOT NULL,      -- 'completed' | 'pending' (legacy) | 'flagged_duplicate' | 'ai_rejected' | 'ai_failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_helper_day ON reward_events (helper_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reward_pair_day ON reward_events (helper_id, thanker_id, created_at);
CREATE INDEX IF NOT EXISTS idx_reward_thanker_day ON reward_events (thanker_id, created_at);
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

-- ============================================================
-- Pidgin Enforcement Layer
-- Independent from the Thank-You tables above: its own toggle, dictionary,
-- offence records, and channel scope. Nothing here references or depends
-- on bot_config / reward_events / custom_phrases.
-- ============================================================

-- Per-guild Pidgin state: on/off toggle and the persisted PO1/PO2/PO3 role IDs.
CREATE TABLE IF NOT EXISTS pidgin_config (
  guild_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  po1_role_id TEXT,
  po2_role_id TEXT,
  po3_role_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Channels excluded from enforcement. Enforcement is server-wide by default;
-- a row here removes that one channel from scope.
CREATE TABLE IF NOT EXISTS pidgin_excluded_channels (
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  excluded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, channel_id)
);

-- Admin-managed Pidgin dictionary entries (single words or multi-word
-- phrases), in addition to the built-in base list in src/pidgin/dictionary.js.
CREATE TABLE IF NOT EXISTS pidgin_terms (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  term TEXT NOT NULL,
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guild_id, term)
);

-- One row per offence. message_id is UNIQUE — this is the single source of
-- truth preventing a message (including via edits, bot restarts, or
-- reprocessing) from ever producing more than one offence.
CREATE TABLE IF NOT EXISTS pidgin_offences (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  channel_id TEXT NOT NULL,
  detected_terms TEXT[] NOT NULL,
  message_content TEXT,
  offence_number INTEGER NOT NULL,
  penalty_type TEXT NOT NULL,      -- 'po1' | 'po2' | 'po3' | 'timeout'
  penalty_detail TEXT NOT NULL,    -- e.g. '-1,000 Action Points' or '10-minute timeout'
  action_success BOOLEAN NOT NULL DEFAULT true,
  failure_reason TEXT,
  was_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pidgin_offence_user_day ON pidgin_offences (guild_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pidgin_offence_guild ON pidgin_offences (guild_id);

-- Manual /pidgin reset events. Never deletes pidgin_offences rows — the
-- daily offence count is derived as "offences since the latest reset
-- today, or since 00:00 UTC if none", so historical records stay intact.
CREATE TABLE IF NOT EXISTS pidgin_manual_resets (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reset_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pidgin_reset_user_day ON pidgin_manual_resets (guild_id, user_id, created_at);

-- Guild-wide reset events (/pidgin resetall). Same non-destructive pattern
-- as pidgin_manual_resets, but applies to every user in the guild at once —
-- e.g. after an escalation-table change, to clear active counts that were
-- accumulated under the old rules without touching offence history.
CREATE TABLE IF NOT EXISTS pidgin_guild_resets (
  id SERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  reset_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pidgin_guild_reset_day ON pidgin_guild_resets (guild_id, created_at);
