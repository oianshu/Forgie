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
import { upsertUserProfile, getUserProfile, listUserTasks, getTask, type TaskDocument } from '../services/appwrite.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

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
    actions.addComponents(
      new ButtonBuilder()
        .setCustomId('myinfo_task_panel')
        .setLabel('Task Panel')
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

    // Add Staff Handbook and GDD DOCS links in a separate row
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL('https://docs.google.com/document/d/19d8TcxOUStYzo4rfkDTvQxQFgT9UOwt4gtuivaU_ZD4/edit?tab=t.0')
          .setLabel('Staff Handbook'),
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setURL('https://docs.google.com/document/d/1mBYL5B9ctTl55SM5O8xwM0Z8vhhAo88gNRBZlq9S_5I/edit?tab=t.0')
          .setLabel('GDD Document')
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

    // Fetch timezone from Appwrite user profile
    const existingProfile = await getUserProfile(user.id, member.guild.id);
    const timezone = existingProfile?.timezone ?? null;

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

    // Check if user has any of the staff roles
    const isStaff = config.STAFF_ROLE_IDS.length > 0 && 
      member.roles.cache.some(role => config.STAFF_ROLE_IDS.includes(role.id));
    
    // Create user profile embed
    const userEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setAuthor({
        name: `User Profile - ${user.username}`,
        iconURL: 'https://emoji.discadia.com/emojis/37f0ffee-05fe-40e9-8a15-fce895dd8ba4.PNG'
      })
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        formatField('Account Created', accountAge),
        formatField('Server Join Date', joinDate),
        formatField('Roblox Username', robloxUsername ?? 'Not linked'),
        formatField('Roblox ID', robloxId ? `[${robloxId}](https://www.roblox.com/users/${robloxId}/profile)` : 'Not linked'),
        formatField('Mention', user.toString()),
        formatField('Account Type', user.bot ? 'Bot' : 'User')
      )
      .setFooter({ 
        text: `User ID: ${user.id} • Forgie v${process.env.npm_package_version ?? '0.1.0'}`,
      })
      .setTimestamp();

    // Generate a consistent 4-digit alphanumeric ID based on user ID
    const userIdHash = user.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    // Ensure we always get a 4-digit alphanumeric code by padding if needed
    const staffId = Math.abs(userIdHash).toString(36).toUpperCase().padEnd(4, '0').substring(0, 4);
    
    // Create staff profile embed (only shown to staff members)
    const staffEmbed = new EmbedBuilder()
      .setColor(0x5865F2) // Match user profile color
      .setAuthor({
        name: `Staff Profile - ${user.username}`,
        iconURL: 'https://cdn3.emoji.gg/emojis/9755-discord-staff-animated.gif'
      })
      .addFields(
        formatField('Status Information', isStaff ? 'Active Staff' : 'Not a Staff Member'),
        formatField('Department Infomation', topRole ? `<@&${topRole.id}>` : 'None'),
        formatField('Timezone Infomation', timezone ?? 'No timezone set')
      )
      .setFooter({ 
        text: `Staff ID: ${staffId}`, // Use generated 4-digit ID
      })
      .setTimestamp();

    // Only show staff embed to staff members
    const embeds = isStaff ? [userEmbed, staffEmbed] : [userEmbed];

    return {
      embeds,
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
      } else if (interaction.customId === 'myinfo_task_panel') {
        // Build Task Panel view (concise + grouped + dropdown for details)
        const tasks = await listUserTasks(member.user.id, member.guild.id);
        const groups: Record<TaskDocument['status'], TaskDocument[]> = {
          assigned: [],
          in_progress: [],
          blocked: [],
          done: []
        };
        for (const t of tasks) groups[t.status].push(t);

        const mkList = (list: TaskDocument[]) =>
          (list.length ? list.slice(0, 12).map((t) => `- \`#${t.task_id}\` — ${t.title}`).join('\n') : '_None_');

        const sections: string[] = [];
        sections.push(`**In Progress (${groups.in_progress.length})**\n${mkList(groups.in_progress)}`);
        sections.push(`\n**Blocked (${groups.blocked.length})**\n${mkList(groups.blocked)}`);
        sections.push(`\n**Assigned (${groups.assigned.length})**\n${mkList(groups.assigned)}`);
        sections.push(`\n**Done (${groups.done.length})**\n${mkList(groups.done)}`);

        const header = tasks.length
          ? '_Use the dropdown below to view a task in detail._'
          : 'You have no assigned tasks.';

        const embed = new EmbedBuilder()
          .setTitle('Your Tasks')
          .setColor(0x5865F2)
          .setDescription(`${header}\n\n${sections.join('\n')}`)
          .setTimestamp();

        // Build dropdown options for details (cap at 25 per Discord limit)
        const options = tasks.slice(0, 25).map((t) => ({
          label: t.title.substring(0, 100),
          description: `#${t.task_id}`.substring(0, 100),
          value: t.task_id
        }));

        const rows = [
          ...buildComponents({ back: true }),
        ];

        if (options.length) {
          rows.push(
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId('myinfo_task_select')
                .setPlaceholder('Select a task to view details...')
                .addOptions(options)
            )
          );
        }

        await interaction.editReply({ embeds: [embed], components: rows });
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
        const perms = member.permissions.toArray().join(', ') || 'No special permissions';
        const embed = new EmbedBuilder()
          .setTitle('Your Permissions')
          .setColor(0x5865F2)
          .setDescription(perms);

        await interaction.editReply({ 
          embeds: [embed],
          components: buildComponents({ back: true })
        });
      } else if (interaction.customId === 'myinfo_task_select') {
        // Show details for a specific task
        const taskId = selected;
        const task = await getTask(taskId);
        if (!task) {
          const embed = new EmbedBuilder()
            .setTitle('Task Details')
            .setColor(0xED4245)
            .setDescription('Task not found or no longer available.');
          await interaction.editReply({ embeds: [embed], components: buildComponents({ back: true }) });
          return;
        }

        const due = task.due_date ? time(new Date(task.due_date), TimestampStyles.LongDateTime) : 'Not set';
        const thread = task.thread_id ? `<#${task.thread_id}>` : 'Not created';
        const embed = new EmbedBuilder()
          .setTitle(`#${task.task_id} — ${task.title}`)
          .setColor(0x5865F2)
          .setDescription(task.description || 'No description provided.')
          .addFields(
            { name: 'Status', value: task.status.replace(/_/g, ' '), inline: true },
            { name: 'Progress', value: `${task.progress}%`, inline: true },
            { name: 'Priority', value: (task.priority || 'medium').toUpperCase(), inline: true },
            { name: 'Due', value: String(due), inline: true },
            { name: 'Thread', value: thread, inline: true },
          )
          .setTimestamp();

        // Keep back buttons visible: Back to Profile and Back to Task Panel
        const backRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
          ...buildComponents({ back: true }),
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId('myinfo_task_panel')
              .setLabel('Back to Task Panel')
              .setStyle(ButtonStyle.Secondary)
          )
        ];
        await interaction.editReply({ embeds: [embed], components: backRows });
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
