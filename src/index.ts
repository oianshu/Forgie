import { 
  Client, 
  GatewayIntentBits, 
  Collection, 
  Events, 
  type ChatInputCommandInteraction, 
  type SlashCommandBuilder 
} from 'discord.js';
import { ensureCollections } from './services/appwrite.js';
import { logger } from './utils/logger.js';

// Define command type
type Command = {
  data: SlashCommandBuilder;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
};

// Extend the Client class to include commands
class ForgieClient extends Client {
  commands: Collection<string, Command>;
  
  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.commands = new Collection();
  }
}

// Import commands
import { data as myinfoCommand, execute as myinfoExecute, handleComponent } from './commands/myinfo.js';

// Initialize Discord client
const client = new ForgieClient();

// Load commands
client.commands.set(myinfoCommand.name, {
  data: myinfoCommand,
  execute: myinfoExecute
});

// Handle errors
process.on('unhandledRejection', (error) => {
  logger.error({ error }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  process.exit(1);
});

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async (c) => {
  logger.info(`Logged in as ${c.user.tag}`);
  
  try {
    await ensureCollections();
    logger.info('Appwrite collections ensured');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to ensure Appwrite collections: ${errorMessage}`);
  }
});

// Event: Handle slash commands and button interactions
client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        logger.error({ err: error }, 'Command execution failed');
        
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ 
            content: 'There was an error while executing this command!',
            embeds: [],
            components: []
          });
        } else {
          await interaction.reply({ 
            content: 'There was an error while executing this command!',
            ephemeral: true 
          });
        }
      }
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
      try {
        await handleComponent(interaction);
      } catch (error) {
        logger.error({ err: error }, 'Error handling button interaction');
        
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ 
            content: 'There was an error processing this interaction!',
            embeds: [],
            components: []
          });
        } else {
          await interaction.reply({ 
            content: 'There was an error processing this interaction!',
            ephemeral: true 
          });
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Unhandled error in interaction handler');
  }
});

// Login to Discord
client.login(process.env.DISCORD_TOKEN).catch(error => {
  logger.error('Failed to login to Discord:', error);
  process.exit(1);
});

// Web server can be started here in the future if needed
// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => {
//   logger.info(`Web server running on port ${PORT}`);
// });
