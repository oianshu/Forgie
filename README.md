# Forgie — Discord Management Bot (TypeScript)

Modern, secure Discord management bot built with TypeScript and discord.js v14. Implements `/myinfo` with Components v2, Appwrite persistence, and Bloxlink integration.

## Features
- Slash command `/myinfo` (ephemeral embed)
- Action Buttons: Refresh, Manage Privacy
- Appwrite persistence (users, audits)
- Bloxlink Roblox username lookup
- Zod-validated env, Pino logging, robust error handling

## Tech Stack
- TypeScript (strict), discord.js v14
- Appwrite SDK
- tsup for builds, ts-node-dev for dev
- ESLint + Prettier, Vitest

## Setup
1. Clone and install
```bash
pnpm i # or npm i / yarn
```
2. Create `.env` from `.env.example` and fill values.
3. Register commands
```bash
pnpm run register
```
4. Start bot (dev)
```bash
pnpm run dev
```

## Environment Variables
See `.env.example`. All validated at startup by `src/config.ts`.

## Security & Privacy
- No secrets in code; use `.env`.
- Emails are not accessible via bot tokens. If a future OAuth2 flow is added with `email` scope, store only minimal data and ask for consent.
- All `/myinfo` responses are ephemeral.

## Appwrite Collections
- users: { discord_id, guild_id, username, joined_at, highest_role_id, highest_role_name, roblox_username, email_available, last_seen_at }
- audits: { action, actor_discord_id, guild_id, timestamp, metadata }

## Notes
- Bloxlink API schema may vary; adjust mapping in `src/services/bloxlink.ts`.
- For development, use `DISCORD_GUILD_ID` to register commands guild-scoped. For production, set `NODE_ENV=production` and deploy global commands.
