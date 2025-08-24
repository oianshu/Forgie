import { Client, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { logger } from './utils/logger.js';

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember],
});

client.once('ready', () => {
  logger.info({ tag: client.user?.tag }, 'Forgie is online');
  client.user?.setPresence({
    activities: [{ name: 'your staff info', type: ActivityType.Watching }],
    status: 'online',
  });
});
