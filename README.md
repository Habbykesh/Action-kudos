# Community Helper & Appreciation Reward Bot

Implements the spec: reply-based thank-you detection → helper reward
(1,000 Action Points via a temporary `Helper` role + MEE6, or 100 pending
Engage Points logged to an audit channel). No AI — a curated, multilingual
phrase list, extendable per-server with `/thanks add`.

## What's inside

```
src/
  index.js           entry point: client, event wiring, startup
  config.js          env var loading/validation
  phrases.js         built-in multilingual phrase library
  matcher.js         text normalization + phrase matching
  customPhrases.js   DB-backed per-server custom phrases
  phraseEngine.js     merges built-in + custom, cached per guild
  rewardService.js   the core pipeline: validity, limits, DB writes, rewards
  helperRole.js      creates/reuses the persistent "Helper" role
  botConfig.js       per-guild config + heartbeat (for recovery)
  recovery.js        downtime recovery scan
  audit.js           audit-channel embeds
  commands/thanks.js /thanks add|remove|list
  deploy-commands.js registers the slash command
  db/schema.sql      Postgres schema (idempotent)
  db/migrate.js      applies schema.sql on startup
```

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
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=268520448&scope=bot%20applications.commands
```

That permission integer covers: View Channels, Send Messages, Read Message
History, Manage Roles, Embed Links. **Important:** in Server Settings →
Roles, drag the bot's role **above** both the `OG` role and the `Helper`
role it will create — Discord won't let a bot assign/manage a role positioned
above its own.

### Collect the IDs you'll need

Enable Developer Mode (User Settings → Advanced), then right-click to copy:
- Your server → `GUILD_ID`
- Your existing `OG` role → `OG_ROLE_ID`
- The channel you want reward audit logs posted in → `AUDIT_CHANNEL_ID`

## 2. Set up Railway

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** (push this folder to a new GitHub repo first, or use `Empty Project` and Railway's CLI — GitHub is easiest).
2. In the same project, **+ New → Database → Add PostgreSQL**.
3. Click your bot service → **Variables** tab, and add:

   | Variable | Value |
   |---|---|
   | `DISCORD_TOKEN` | from step 1 |
   | `CLIENT_ID` | from step 1 |
   | `GUILD_ID` | your server ID |
   | `OG_ROLE_ID` | your OG role ID |
   | `AUDIT_CHANNEL_ID` | your audit channel ID |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference variable — click "Add Reference" and pick the Postgres service's `DATABASE_URL`) |

   Optional (defaults shown, only add if you want different values):
   `ACTION_POINTS_PER_REWARD=1000`, `ENGAGE_POINTS_PER_REWARD=100`,
   `HELPER_DAILY_LIMIT=15`, `HELP_WINDOW_HOURS=24`,
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

`/thanks` and `/rewards` need to be registered once (and again only if you
change a command's structure). Easiest way with Railway: open the service →
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

## 4. The system starts OFF by default

**Important:** on a fresh install, the reward system is disabled until you
turn it on — no thank-you will be rewarded, nothing will be posted, even
though the bot is online. This is deliberate, so you can deploy, test, and
review before anything is user-facing.

Run `/rewards status` to confirm it's off, and `/rewards enable` whenever
you're ready to go live. `/rewards disable` turns it back off at any time —
the bot stays online and connected, it just ignores thank-yous while
disabled (nothing is queued up to process later).

## 5. Verify it works

1. In your server, have one member reply to another member's message with
   "thanks!" — the helper should either get the temporary `Helper` role
   (if OG) or a public pending-Engage-Points message (if not OG), and an
   entry should appear in your audit channel.
2. Run `/thanks list` to confirm the command works and see custom phrases (empty at first).
3. Run `/thanks add big ups`, then test that phrase in a reply.
4. Restart the Railway service (Settings → Restart) mid-conversation, send a
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
- **Phrase matching**: plain curated substring/word-boundary matching, no
  AI — predictable and fully auditable, exactly as specified. The built-in
  library is a solid starting set per language; use `/thanks add` /
  `/thanks remove` to tune it to how your community actually talks.

## Extending later

- Want reaction-based thanks (👍/🙏 emoji) in addition to replies? That's a
  deliberate spec choice to require replies for unambiguous attribution —
  can be added as an opt-in alternate trigger if you change your mind.
- Want a `/thanks stats` command showing a helper's reward history? The
  `reward_events` table already has everything needed — it's a simple
  addition.
