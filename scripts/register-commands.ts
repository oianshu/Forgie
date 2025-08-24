import { REST, Routes } from 'discord.js';
import { config } from '../src/config.js';
import { data as myinfo } from '../src/commands/myinfo.js';
import { logger } from '../src/utils/logger.js';

async function register() {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
  const cmds = [myinfo.toJSON()];

  if (config.NODE_ENV !== 'production' && config.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.DISCORD_GUILD_ID), {
      body: cmds,
    });
    logger.info('Registered guild commands for development');
  } else {
    await rest.put(Routes.applicationCommands(config.DISCORD_CLIENT_ID), { body: cmds });
    logger.info('Registered global commands');
  }
}

register().catch((e) => {
  logger.error({ err: e }, 'Failed to register commands');
  process.exit(1);
});
