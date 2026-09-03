# Action Kudos

Two fully independent systems in one bot:

- **Thank-You Recognition Layer** — reply-based thank-you detection, then a
  Gemini AI verification step that classifies the thank-you as genuine
  ecosystem-relevant help or a mere pleasantry, then a universal 1,000
  Action Point reward (via a temporary `Helper` role + MEE6) for every
  AI-verified genuine thank-you. Detection itself is still a curated,
  multilingual phrase list, extendable per-server with `/thanks add` — the
  AI only ever answers "help or pleasantry?", never reward amount or
  eligibility.
- **Pidgin Enforcement Layer** — detects configured Pidgin words/phrases
  (stretched spellings, punctuation, and emoji included) and escalates
  per-user, per-UTC-day: a warning on the 1st offence, then PO1/PO2/PO3
  role → Action Point deduction on the 2nd–4th, then a 10-minute → 1-hour →
  1-hour → 24-hour Discord timeout on the 5th–8th. No AI here — a plain,
  word-boundary-safe dictionary match, extendable with `/pidgin add`.

Each layer has its own on/off toggle (`/rewards` vs `/pidgin on|off`) and its
own database tables. **Turning one off has no effect on the other** — see
"Independence" below.

## What's inside

```
src/
  index.js             entry point: client, event wiring, startup
  config.js            env var loading/validation
  db/schema.sql         Postgres schema (idempotent)
  db/migrate.js         applies schema.sql on startup

  --- Thank-You Recognition Layer ---
  phrases.js           built-in multilingual phrase library
  matcher.js            text normalization + phrase matching
  customPhrases.js      DB-backed per-server custom phrases
  phraseEngine.js        merges built-in + custom, cached per guild
  aiVerifier.js          Gemini binary classifier: GENUINE_HELP vs PLEASANTRY
  rewardService.js      the core pipeline: eligibility, AI gate, DB writes, universal reward
  helperRole.js         creates/reuses the persistent "Helper" role
  botConfig.js          per-guild config + heartbeat (for recovery)
  recovery.js           downtime recovery scan
  audit.js              audit-channel embeds
  commands/thanks.js    /thanks add|remove|list
  commands/rewards.js   /rewards enable|disable|status

  --- Pidgin Enforcement Layer ---
  pidgin/dictionary.js        built-in base Pidgin term list
  pidgin/normalize.js         text normalization (stretched letters, emoji/punctuation)
  pidgin/matcher.js           word-boundary-safe matching, returns matched terms
  pidgin/customTerms.js       DB-backed per-server custom dictionary entries
  pidgin/dictionaryEngine.js  merges built-in + custom, cached per guild
  pidgin/pidginConfig.js      enabled toggle, PO role IDs, channel exclusions
  pidgin/dailyState.js        per-user/UTC-day offence counting + manual reset logic
  pidgin/poRoles.js           creates/reuses the PO1/PO2/PO3 roles
  pidgin/pidginPunishment.js  offence -> escalation table + apply logic
  pidgin/pidginService.js     the core pipeline: detect, dedupe, punish, warn, log
  pidgin/pidginAudit.js       audit-channel embeds
  commands/pidgin.js          /pidgin on|off|add|remove|list|reset|settings|channels

  deploy-commands.js  registers all slash commands
```

## Independence

The Pidgin Enforcement Layer does not check whether the Thank-You system is
enabled, and vice versa. Concretely:

- Separate DB tables (`pidgin_*` vs `reward_events`/`custom_phrases`/`bot_config`).
- Separate enabled-flag caches and separate audit-embed builders.
- `messageCreate` calls `tryProcessThankYou()` and `pidginService.processMessage()`
  independently — neither call is gated on the other's result.

`Thank-You: OFF` + `Pidgin: ON` (or vice versa) both work exactly as expected.

## 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy it. This is `DISCORD_TOKEN`.
3. On the same **Bot** tab, enable:
   - **Server Members Intent**
   - **Message Content Intent**
   (Both are required — the bot reads message content to detect thank-yous, and needs member data for role/permission checks.)
4. **OAuth2 → General** → copy the **Application (Client) ID**. This is `CLIENT_ID`.

### Invite the bot to your server

Build an invite URL (replace `CLIENT_ID`):

```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=1099780148224&scope=bot%20applications.commands
```

That permission integer covers: View Channels, Send Messages, Read Message
History, Manage Roles, Embed Links, and **Moderate Members** (the last one is
needed for the Pidgin layer's timeout punishments). **Important:** in Server
Settings → Roles, drag the bot's role **above** the `Helper`, `PO1`, `PO2`,
and `PO3` roles it will create — Discord won't let a bot assign/manage a
role positioned above its own, and both layers check this before attempting
a role assignment so they can log a clear failure instead of a raw API error.

### Collect the IDs you'll need

Enable Developer Mode (User Settings → Advanced), then right-click to copy:
- Your server → `GUILD_ID`
- The channel you want reward/enforcement audit logs posted in → `AUDIT_CHANNEL_ID`

### Get a Gemini API key

Go to [Google AI Studio](https://aistudio.google.com/apikey) → **Create API
key**. No credit card required for the free tier. This is `GEMINI_API_KEY`
— required, since the Thank-You layer now can't verify (and therefore won't
reward) anything without it.

## 2. Set up Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** (push this folder to a new GitHub repo first, or use `Empty Project` and Railway's CLI — GitHub is easiest).
2. In the same project, **+ New → Database → Add PostgreSQL**.
3. Click your bot service → **Variables** tab, and add:

   | Variable | Value |
   |---|---|
   | `DISCORD_TOKEN` | from step 1 |
   | `CLIENT_ID` | from step 1 |
   | `GUILD_ID` | your server ID |
   | `AUDIT_CHANNEL_ID` | your audit channel ID |
   | `GEMINI_API_KEY` | from Google AI Studio |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable — click "Add Reference" and pick the Postgres service's `DATABASE_URL`) |

   Optional (defaults shown, only add if you want different values):
   `GEMINI_MODEL=gemini-3.6-flash`, `GEMINI_TIMEOUT_MS=8000`,
   `GEMINI_CONTEXT_MESSAGE_COUNT=4`, `ACTION_POINTS_PER_REWARD=1000`,
   `HELPER_DAILY_LIMIT=15`, `THANKER_DAILY_LIMIT=15`, `HELP_WINDOW_HOURS=24`,
   `HEARTBEAT_INTERVAL_MS=30000`, `DATABASE_SSL=false`.

4. **Settings** tab on the bot service → confirm:
   - **Start Command**: `npm start`
   - Root directory: wherever this folder lives in your repo (leave blank if it's the repo root).

5. Deploy. Railway will run `npm install` then `npm start`, which:
   - applies the DB schema automatically (safe to run every deploy — it's all `CREATE TABLE IF NOT EXISTS`),
   - creates the `Helper` role in your server if it doesn't already exist,
   - scans for any thank-yous missed since it was last online,
   - starts listening in real time.

## 3. Register the slash commands

`/thanks`, `/rewards`, and `/pidgin` need to be registered once (and again
only if you change a command's structure). Easiest way with Railway: open
the service →
**⋮ menu → Run Command** (or use `railway run`) and run:

```
npm run deploy-commands
```

Alternatively, run it locally once with the same `.env` values:

```bash
cp .env.example .env   # fill in the real values
npm install
npm run deploy-commands
```

Since commands are registered per-guild (`GUILD_ID`), they show up
instantly — no waiting on global command propagation.

## 4. Both systems start OFF by default

**Important:** on a fresh install, both the reward system and Pidgin
Enforcement are disabled until you turn each on individually — the bot
being online doesn't mean either one is active. This is deliberate, so you
can deploy, test, and review before anything is user-facing.

- `/rewards status` / `/rewards enable` / `/rewards disable` — Thank-You layer.
- `/pidgin settings` / `/pidgin on` / `/pidgin off` — Pidgin layer.

They're independent toggles: enabling one does not enable the other, and
disabling one does not affect the other. Neither queues up anything to
process later while off — it's ignored in real time, not backfilled.

### Pidgin Enforcement quick reference

| Command | What it does |
|---|---|
| `/pidgin on` / `/pidgin off` | Toggle enforcement for this server |
| `/pidgin add <term>` | Add a word or phrase, e.g. `/pidgin add no wahala` |
| `/pidgin remove <term>` | Remove a custom term (base dictionary can't be removed) |
| `/pidgin list` | Show custom terms + the built-in base dictionary |
| `/pidgin channels list` | Show which channels are excluded |
| `/pidgin channels remove #channel` | Exclude a channel (enforcement is server-wide by default) |
| `/pidgin channels add #channel` | Re-include a previously excluded channel |
| `/pidgin streak @user` | Check a user's current offence count for today and what their next offence would trigger |
| `/pidgin reset @user` | Zero out one user's active offence count for today (history kept) |
| `/pidgin resetall confirm:true` | Zero out **everyone's** active offence count for today (history kept) — e.g. after changing the escalation table |
| `/pidgin settings` | Full current configuration at a glance |

Escalation (per user, per UTC calendar day, resets at 00:00 UTC):

| Offence | Action |
|---|---|
| 1st | Warning only — no penalty |
| 2nd | `PO1` role → −1,000 Action Points |
| 3rd | `PO2` role → −3,000 Action Points |
| 4th | `PO3` role → −10,000 Action Points |
| 5th | 10-minute timeout |
| 6th | 1-hour timeout |
| 7th | 1-hour timeout |
| 8th | 24-hour timeout |

Members with **Manage Server** and bot accounts are always exempt. Deleting
an offending message doesn't reverse the offence — the record and any
applied punishment stand.

## 5. Verify it works

1. In your server, have one member reply to another member's message with
   something acknowledging real help, e.g. "thanks for explaining how to
   connect my wallet!" — after a moment (the Gemini call), the helper should
   get the temporary `Helper` role and a public reward message, with an
   entry in your audit channel. Then try a pure pleasantry reply like
   "thanks for the welcome!" — it should be silently classified as
   PLEASANTRY and produce no reward (check your terminal/Railway logs to
   confirm the AI call happened).
2. Run `/thanks list` to confirm the command works and see custom phrases (empty at first).
3. Run `/thanks add big ups`, then test that phrase in a reply.
4. Temporarily set `GEMINI_API_KEY` to something invalid and redeploy —
   confirm a would-be genuine thank-you now produces an
   "AI VERIFICATION FAILED" entry in the audit channel instead of a reward,
   then restore the real key.
5. Restart the Railway service (Settings → Restart) mid-conversation, send a
   qualifying thank-you while it's down, then bring it back — it should
   catch up on startup via the recovery scan.

## Notes on the implementation vs. the spec

- **Single-server design**: `GUILD_ID` is fixed via env var, matching "not a
  public, universal reputation bot."
- **Manage Server exclusion**: checked live via Discord's actual
  `ManageGuild` permission on the helper at the moment of the thank-you, not
  a role-name guess.
- **One reward per message**: enforced with a `UNIQUE` constraint on the
  thank-you's Discord message ID — edits can't create a second reward, and
  deletions don't reverse an already-recorded one.
- **Daily limits**: computed against UTC calendar-day boundaries (not a
  rolling 24h window), per spec §8.
- **Recovery**: on every startup, the bot records a heartbeat every 30s
  while running and, on boot, scans every readable channel for messages
  since the last heartbeat, running them through the identical validation
  pipeline. Threads aren't scanned in this first version — let me know if
  you want that added.
- **Phrase matching stays deterministic**: detecting a *potential*
  thank-you is still plain curated substring/word-boundary matching, no AI
  — that part is predictable and fully auditable. The built-in library is a
  solid starting set per language; use `/thanks add` / `/thanks remove` to
  tune it to how your community actually talks.
- **AI is a binary gate, nothing more**: `aiVerifier.js` only ever returns
  `GENUINE_HELP`, `PLEASANTRY`, or `null` (failure). It never sees or
  decides reward amount, daily limits, roles, or eligibility — all of that
  is resolved by deterministic checks in `rewardService.js` before the AI
  is ever called, both to keep the AI's blast radius small and to conserve
  free-tier Gemini quota (spec §9).
- **Fail-safe on AI failure**: a timeout, HTTP error, unparseable response,
  or unexpected classification value all collapse to the same outcome — no
  reward, logged to `reward_events` (`ai_failed`) and posted to the audit
  channel for a human to review, per spec §8.
- **Pleasantries are logged too**: a `PLEASANTRY` classification also
  writes a row (`ai_rejected`) — not for the audit channel (that'd be
  noisy), but so the exact same message can never be reprocessed twice
  (e.g. by the downtime-recovery scan) and so there's a paper trail if you
  want to review the AI's calls later.
- **Universal reward**: the OG/non-OG split and the old 100 Engage Points
  path are both gone. Every AI-verified genuine-help thank-you earns the
  same 1,000 Action Points via the same Helper-role + MEE6 mechanism —
  `og_status` stays in the schema for backward compatibility with old rows
  but is always `true` going forward and no longer means anything.

### Pidgin Enforcement Layer

- **Base dictionary**: `omo`, `dey`, `abeg`, `una`, `watin`, `wetin`,
  `wahala`, `sabi` — `na` was removed since it was prone to sitting inside
  otherwise-innocuous words even with word-boundary matching guarding
  against direct substring hits. Add it back anytime with `/pidgin add na`
  if you want it.
- **Stretched-spelling detection**: any run of 2+ identical letters
  collapses to one before matching, so `omo`/`omoo`/`omoooo`/`omoooooo` all
  normalize to the same form — same for the dictionary entries themselves,
  so matching stays consistent in both directions.
- **False-positive protection**: matching is word-boundary-safe, not plain
  substring — e.g. `banana` won't trigger on a bare `na` if you ever add it
  back, per spec §4.
- **Escalation starts with a warning**: the 1st offence in a day is a
  warning only (no AP loss, no timeout) — see the table above. `PO1`/`PO2`/
  `PO3` now trigger on the 2nd–4th offence, and timeouts on the 5th–8th.
- **One offence per message, always**: enforced with a `UNIQUE` constraint
  on the Discord message ID (`pidgin_offences.message_id`), guarded by a
  Postgres advisory lock per user+guild during the check-and-insert to
  close the race-condition window the spec calls out in §20 — covers edits,
  restarts, and reprocessing.
- **Edited messages**: scanned via the `messageUpdate` event, going through
  the identical pipeline as new messages, still capped at one offence via
  the same message-ID uniqueness.
- **Daily counting without deleting history**: a user's "current" offence
  count is computed as offences since 00:00 UTC, or since their most recent
  `/pidgin reset`, or since the guild's most recent `/pidgin resetall` —
  whichever is latest — so resets zero the active count without ever
  deleting a `pidgin_offences` row.
- **Checking someone's current count**: `/pidgin streak @user` reads that
  same computed value without recording anything, and previews what their
  next offence today would trigger.
- **Channel scope**: server-wide by default; `/pidgin channels remove`
  excludes a channel, `/pidgin channels add` re-includes it. Supports any
  number of channels.
- **PO1/PO2/PO3 automation**: the bot assigns the relevant PO role (letting
  your existing Action Points role-trigger automation react to it), waits a
  few seconds, then removes the role again — exactly the "assign → AP
  deduction fires → remove" flow in spec §11. Role hierarchy is checked
  before every assignment attempt.
- **Never silently fails**: role-assignment and timeout failures are logged
  to the audit channel with the expected action and the failure reason, and
  the offence itself is still recorded either way (spec §19).

## Extending later

- Want reaction-based thanks (👍/🙏 emoji) in addition to replies? That's a
  deliberate spec choice to require replies for unambiguous attribution —
  can be added as an opt-in alternate trigger if you change your mind.
- Want a `/thanks stats` command showing a helper's reward history? The
  `reward_events` table already has everything needed — it's a simple
  addition.
