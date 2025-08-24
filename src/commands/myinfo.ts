import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type GuildMember,
  time,
  TimestampStyles,
  StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
  type StringSelectMenuInteraction
} from 'discord.js';
import { getTopRole } from '../utils/format.js';
import { getRobloxInfo } from '../services/bloxlink.js';
import { upsertUserProfile } from '../services/appwrite.js';
import { logger } from '../utils/logger.js';

interface MyInfoPayload {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

function buildComponents(opts: { back?: boolean } = {}): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];

  // First row with primary actions
  const actions = new ActionRowBuilder<MessageActionRowComponentBuilder>();
  actions.addComponents(
    new ButtonBuilder()
      .setCustomId('myinfo_refresh')
      .setLabel('Refresh Info')
      .setStyle(ButtonStyle.Primary)
  );

  if (opts.back) {
    actions.addComponents(
      new ButtonBuilder()
        .setCustomId('myinfo_back')
        .setLabel('Back to Profile')
        .setStyle(ButtonStyle.Secondary)
    );
  } else {
    actions.addComponents(
      new ButtonBuilder()
        .setCustomId('myinfo_server')
        .setLabel('Server Info')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  rows.push(actions);

  // Only show the select menu on the main view
  if (!opts.back) {
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('myinfo_actions')
          .setPlaceholder('Select an action...')
          .addOptions([
            {
              label: 'View Roles',
              description: 'See all your server roles',
              value: 'view_roles'
            },
            {
              label: 'View Permissions',
              description: 'See your server permissions',
              value: 'view_permissions'
            }
          ])
      )
    );
  }

  return rows;
}

function formatField(name: string, value: string | null, inline = true) {
  return { name: `• ${name}`, value: value || 'Not available', inline };
}

export const data = new SlashCommandBuilder()
  .setName('myinfo')
  .setDescription('Show your staff info (ephemeral)');

async function buildMyInfoPayload(member: GuildMember): Promise<MyInfoPayload> {
  try {
    const user = member.user;
    const topRole = getTopRole(member);
    // Get Roblox info (username and ID) with guild context for higher accuracy
    logger.info({ userId: user.id, guildId: member.guild.id }, '[MyInfo] Fetching Roblox info');
    const robloxInfo = await getRobloxInfo(user.id, { guildId: member.guild.id });
    const robloxUsername = robloxInfo.username;
    const robloxId = robloxInfo.id;
    logger.info({ userId: user.id, robloxUsername, robloxId }, '[MyInfo] Roblox info result');
    const joinDate = member.joinedAt ? time(member.joinedAt, TimestampStyles.RelativeTime) : 'Unknown';
    const accountAge = time(user.createdAt, TimestampStyles.RelativeTime);

    // Save user data to Appwrite
    try {
      await upsertUserProfile({
        discord_id: user.id,
        guild_id: member.guild.id,
        username: user.tag,
        joined_at: member.joinedAt?.toISOString() ?? null,
        highest_role_id: topRole?.id ?? null,
        highest_role_name: topRole?.name ?? null,
        roblox_username: robloxUsername ?? null,
        last_seen_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('Failed to save user profile:', e);
    }

    // Create main embed
    const mainEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `User Information - ${user.username}`,
        iconURL: user.displayAvatarURL()
      })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        formatField('Account Created', accountAge),
        formatField('Server Join Date', joinDate),
        formatField('Department', topRole ? `<@&${topRole.id}>` : 'None')
      )
      .setFooter({ 
        text: `User ID: ${user.id} • Forgie v${process.env.npm_package_version ?? '0.1.0'}`,
      })
      .setTimestamp();

    // Create secondary embed for additional info
    const infoEmbed = new EmbedBuilder()
      .setColor(0x2F3136)
      .addFields(
        formatField('Roblox Username', robloxUsername ?? 'Not linked'),
        formatField('Roblox ID', robloxId ?? 'Not linked'),
        formatField('Mention', user.toString()),
        formatField('Account Type', user.bot ? 'Bot' : 'User')
      );

    return {
      embeds: [mainEmbed, infoEmbed],
      components: buildComponents()
    };
  } catch (e) {
    console.error('Failed to build my info payload:', e);
    throw e;
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Defer the reply immediately to avoid the "Unknown interaction" error
  await interaction.deferReply({ ephemeral: true });
  
  if (!interaction.inGuild()) {
    await interaction.editReply({ content: 'This command can only be used in a server.' });
    return;
  }

  try {
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) throw new Error('Failed to fetch member');
    
    const { embeds, components } = await buildMyInfoPayload(member);
    await interaction.editReply({ embeds, components });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, 'Error in myinfo command');
    
    const errorContent = 'An error occurred while fetching your info. Please try again later.';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorContent, embeds: [], components: [] });
    } else {
      await interaction.reply({ content: errorContent, ephemeral: true });
    }
  }
}

export async function handleComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inGuild()) return;
  try {
    await interaction.deferUpdate();
    const member = await interaction.guild?.members.fetch(interaction.user.id);
    if (!member) return;

    if (interaction.isButton()) {
      if (interaction.customId === 'myinfo_refresh') {
        const { embeds, components } = await buildMyInfoPayload(member);
        await interaction.editReply({ embeds, components });
      } else if (interaction.customId === 'myinfo_server') {
        // Handle server info button
        if (!interaction.guild) {
          await interaction.editReply({ 
            content: 'This command can only be used in a server.',
            embeds: [],
            components: []
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Server Information')
          .setColor(0x5865F2)
          .addFields(
            { name: 'Server Name', value: interaction.guild.name, inline: true },
            { name: 'Member Count', value: interaction.guild.memberCount.toString(), inline: true },
            { name: 'Server Created', value: time(interaction.guild.createdAt, TimestampStyles.RelativeTime), inline: true }
          );
        
        await interaction.editReply({ 
          embeds: [embed],
          components: buildComponents({ back: true })
        });
      } else if (interaction.customId === 'myinfo_back') {
        const { embeds, components } = await buildMyInfoPayload(member);
        await interaction.editReply({ embeds, components });
      }
    } else if (interaction.isStringSelectMenu()) {
      const [selected] = interaction.values;
      
      if (selected === 'view_roles') {
        const roles = Array.from(member.roles.cache.values())
          .filter((role: { id: string }) => role.id !== interaction.guildId)
          .sort((a: { position: number }, b: { position: number }) => b.position - a.position)
          .map((role: { toString: () => string }) => role.toString())
          .join('\n') || 'No roles';
        
        const embed = new EmbedBuilder()
          .setTitle('Your Roles')
          .setDescription(roles)
          .setColor(0x5865F2);
        
        await interaction.editReply({ 
          embeds: [embed],
          components: buildComponents({ back: true })
        });
      } else if (selected === 'view_permissions') {
        const permissions = member.permissions.toArray().join('\n') || 'No special permissions';
        
        const embed = new EmbedBuilder()
          .setTitle('Your Permissions')
          .setDescription(`\`\`\`\n${permissions}\n\`\`\``)
          .setColor(0x5865F2);
        
        await interaction.editReply({ 
          embeds: [embed],
          components: buildComponents({ back: true })
        });
      }
    }
  } catch (error) {
    logger.error({ error }, 'Error handling component interaction');
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ 
        content: 'An error occurred while processing this action.', 
        embeds: [], 
        components: [] 
      });
    } else {
      await interaction.reply({ 
        content: 'An error occurred while processing this action.', 
        ephemeral: true 
      });
    }
  }
}
