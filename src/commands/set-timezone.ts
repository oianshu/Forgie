import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
  AttachmentBuilder
} from 'discord.js';
import { isValidIanaTz, suggestTimezones, IANATimezones } from '../utils/timezones.js';
import { setUserTimezone } from '../services/appwrite.js';
import { logger } from '../utils/logger.js';

export const data = new SlashCommandBuilder()
  .setName('set-timezone')
  .setDescription('Manage your timezone stored for this server')
  .addSubcommand(sub =>
    sub
      .setName('set')
      .setDescription('Set your timezone (IANA format, e.g., Asia/Kolkata)')
      .addStringOption(opt =>
        opt
          .setName('tz')
          .setDescription('IANA timezone name')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('list')
      .setDescription('Get a list of IANA timezones to choose from')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ ephemeral: true, content: 'This command can only be used in a server.' });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'list') {
    const content = IANATimezones.join('\n');
    const file = new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: 'iana-timezones.txt' });
    await interaction.reply({ ephemeral: true, content: 'Here is a list of IANA timezones. Use /set-timezone set tz:<value> to set yours.', files: [file] });
    return;
  }

  if (sub === 'set') {
    const tz = interaction.options.getString('tz', true);

    if (!isValidIanaTz(tz)) {
      await interaction.reply({ ephemeral: true, content: `Invalid timezone. Please use a valid IANA timezone (e.g., Asia/Kolkata). Run /set-timezone list to see options.` });
      return;
    }

    try {
      await setUserTimezone(interaction.user.id, interaction.guildId!, tz);
      await interaction.reply({ ephemeral: true, content: `Your timezone has been set to: ${tz}` });
    } catch (e) {
      logger.error({ err: e }, 'Failed to set timezone');
      await interaction.reply({ ephemeral: true, content: 'Failed to save your timezone. Please try again later.' });
    }
    return;
  }
}

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'tz') {
    await interaction.respond([]);
    return;
  }
  const query = String(focused.value || '');
  const results = suggestTimezones(query, 25);
  await interaction.respond(results.map(r => ({ name: r, value: r })));
}
