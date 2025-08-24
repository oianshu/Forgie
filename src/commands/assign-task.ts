import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  PermissionsBitField,
  userMention,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
  time,
  TimestampStyles,
  type TextChannel,
  type ThreadChannel,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ModalActionRowComponentBuilder,
  ThreadAutoArchiveDuration,
  ChannelType
} from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createTask, updateTaskProgress, updateTask, type TaskDocument } from '../services/appwrite.js';

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inGuild()) return false;
  const guildMember = interaction.guild?.members.cache.get(interaction.user.id) ?? null;
  const hasPerm = guildMember?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;
  if (hasPerm) return true;
  // Allow via STAFF_ROLE_IDS list too
  const staffIds = (config.STAFF_ROLE_IDS as unknown as string[] | string) as string[];
  if (guildMember && Array.isArray(staffIds) && staffIds.length) {
    return guildMember.roles.cache.some(r => staffIds.includes(r.id));
  }
  return false;
}

function taskEmbed(doc: TaskDocument): EmbedBuilder {
  const dueText = doc.due_date ? time(new Date(doc.due_date), TimestampStyles.ShortDateTime) : 'Not set';
  return new EmbedBuilder()
    .setAuthor({
      name: 'Task Assignment',
      iconURL: 'https://cdn3.emoji.gg/emojis/93796-applications-blurple.gif'
    })
    .setColor(0x5864f1)
    .setTitle(doc.title)
    .setDescription(doc.description || 'No description provided')
    .addFields(
      { name: 'Assigned To', value: userMention(doc.assigned_to), inline: true },
      { name: 'Assigned By', value: userMention(doc.assigned_by), inline: true },
      { name: 'Priority', value: (doc.priority || 'medium').toUpperCase(), inline: true },
      { name: 'Status', value: doc.status.replace(/_/g, ' '), inline: true },
      { name: 'Progress', value: `${doc.progress}%`, inline: true },
      { name: 'Due', value: String(dueText), inline: true },
    )
    .setFooter({ text: `Task ID: ${doc.task_id}` })
    .setTimestamp(new Date(doc.updated_at));
}

function buildControls(taskId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const progressRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`task:progress:${taskId}`)
      .setPlaceholder('Set progress')
      .addOptions(
        { label: '0%', value: '0' },
        { label: '25%', value: '25' },
        { label: '50%', value: '50' },
        { label: '75%', value: '75' },
        { label: '100%', value: '100' },
      )
  );
  const statusRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`task:status:${taskId}`)
      .setPlaceholder('Set status')
      .addOptions(
        { label: 'Assigned', value: 'assigned' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Blocked', value: 'blocked' },
        { label: 'Done', value: 'done' },
      )
  );
  return [progressRow, statusRow];
}

export const data = new SlashCommandBuilder()
  .setName('assign-task')
  .setDescription('Assign a task to a staff member (admin only)')
  .addUserOption(opt =>
    opt
      .setName('assignee')
      .setDescription('Staff member to assign the task to')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt
      .setName('priority')
      .setDescription('Priority of the task')
      .setRequired(true)
      .addChoices(
        { name: 'Low', value: 'low' },
        { name: 'Medium', value: 'medium' },
        { name: 'High', value: 'high' }
      )
  )
  .addStringOption(opt =>
    opt
      .setName('due')
      .setDescription('Due date in YYYY-MM-DD format')
      .setRequired(true)
  );

async function showTaskModal(
  interaction: ChatInputCommandInteraction,
  taskData: Omit<TaskDocument, 'description' | 'title' | 'task_id' | 'created_at' | 'updated_at'>
) {
  try {
    const modal = new ModalBuilder()
      .setCustomId('taskDetailsModal')
      .setTitle('Task Details');

    // Title input
    const titleInput = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('Task Title')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    // Description input
    const descriptionInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Task Description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(2000);

    const firstActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(titleInput);
    const secondActionRow = new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(descriptionInput);
    
    modal.addComponents(firstActionRow, secondActionRow);

    await interaction.showModal(modal);

    const submitted = await interaction.awaitModalSubmit({
      time: 60000,
      filter: i => i.user.id === interaction.user.id,
    }).catch(() => null);

    if (!submitted) return null;

    const title = submitted.fields.getTextInputValue('title');
    const description = submitted.fields.getTextInputValue('description');
    
    // Create the task with the collected description
    const taskId = `${interaction.guildId!.slice(0, 6)}-${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    
    const task: TaskDocument = {
      ...taskData,
      task_id: taskId,
      title,
      description,
      created_at: now,
      updated_at: now,
    };

    await createTask(task);
    await submitted.deferUpdate();
    return { task, interaction: submitted };
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'INTERACTION_COLLECTOR_ERROR') {
      await interaction.followUp({ content: 'Modal submission timed out. Please try again.', ephemeral: true });
    } else {
      logger.error({ error }, 'Error in task description modal');
      await interaction.followUp({ content: 'An error occurred while processing your task.', ephemeral: true });
    }
    return null;
  }
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild()) {
    await interaction.reply({ ephemeral: true, content: 'Use this command in a server.' });
    return;
  }
  if (!isAdmin(interaction)) {
    await interaction.reply({ ephemeral: true, content: 'You do not have permission to use this command.' });
    return;
  }

  const assignee = interaction.options.getUser('assignee', true);
  const priority = interaction.options.getString('priority', true) as 'low' | 'medium' | 'high';
  const dueInput = interaction.options.getString('due', true);
  // Get the pre-set staff channel from config
  const staffChannelId = config.STAFF_CHANNEL_ID;
  let channel: TextChannel | null = null;
  const warnings: string[] = [];
  if (staffChannelId) {
    try {
      const fetched = await interaction.guild!.channels.fetch(staffChannelId);
      if (fetched && fetched.isTextBased() && fetched.type === ChannelType.GuildText) {
        channel = fetched as TextChannel;
      } else {
        logger.warn({ staffChannelId, type: fetched?.type }, 'Staff channel is not a text channel that supports threads');
        warnings.push('Staff channel is not a standard text channel that supports threads. Skipping channel post and thread creation.');
      }
    } catch (e) {
      logger.warn({ err: e, staffChannelId }, 'Failed to fetch staff channel by ID');
      warnings.push('Failed to fetch the staff channel by ID. Check STAFF_CHANNEL_ID and bot permissions.');
    }
  } else {
    logger.warn('STAFF_CHANNEL_ID not set; skipping channel post and thread creation');
    warnings.push('STAFF_CHANNEL_ID not set; skipped channel post and thread creation.');
  }

  // Prepare task data (without description for now)
  // Parse due date
  let due: Date;
  try {
    due = new Date(dueInput);
    if (isNaN(due.getTime())) {
      await interaction.reply({ 
        ephemeral: true, 
        content: '❌ Invalid date format. Please use YYYY-MM-DD format.' 
      });
      return;
    }
  } catch (e) {
    await interaction.reply({ 
      ephemeral: true, 
      content: '❌ Invalid date format. Please use YYYY-MM-DD format.' 
    });
    return;
  }

  const taskData: Omit<TaskDocument, 'description' | 'title' | 'task_id' | 'created_at' | 'updated_at'> = {
    guild_id: interaction.guildId!,
    assigned_by: interaction.user.id,
    assigned_to: assignee.id,
    priority,
    due_date: due.toISOString(),
    status: 'assigned',
    progress: 0,
  };

  // Show the task details modal
  const result = await showTaskModal(interaction, taskData);
  if (!result) return; // Error already handled in showDescriptionModal

  try {
    const { task, interaction: modalInteraction } = result;

    // Compose embed and components
    const embed = taskEmbed(task);
    const components = buildControls(task.task_id);

    // Send DM to assignee
    let dmMessageId: string | null = null;
    let dmFailed = false;
    try {
      const dm = await assignee.createDM();
      const sent = await dm.send({ embeds: [embed], components });
      dmMessageId = sent.id;
    } catch (e) {
      dmFailed = true;
      logger.warn({ err: e }, 'Failed to DM assignee');
    }

    // Send to staff channel if provided
    let channelMessageId: string | null = null;
    let channelId: string | null = null;
    let threadId: string | null = null;
    if (channel && channel.isTextBased()) {
      try {
        // Do not ping in staff channel; only post the embed
        const sent = await channel.send({
          embeds: [embed],
          components,
        });
        channelMessageId = sent.id;
        channelId = channel.id;

        // Create a private thread for the task and invite participants
        try {
          const thread = await (channel as TextChannel).threads.create({
            name: `task-${task.task_id}`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            type: ChannelType.PrivateThread,
            invitable: false,
            reason: `Private thread for task ${task.task_id}`,
          });
          threadId = thread.id;

          // Invite assignee and the assigning admin
          try { await thread.members.add(assignee.id); } catch (e) { logger.debug({ err: e }, 'Failed to add assignee to thread'); }
          try { await thread.members.add(interaction.user.id); } catch (e) { logger.debug({ err: e }, 'Failed to add admin to thread'); }

          // Also invite all members with the admin role ID provided
          const ADMIN_ROLE_ID = '1400716176782262322';
          try {
            const role = interaction.guild?.roles.cache.get(ADMIN_ROLE_ID);
            if (role) {
              for (const [memberId] of role.members) {
                try {
                  await thread.members.add(memberId);
                } catch (e) {
                  logger.debug({ err: e, memberId }, 'Failed to add admin role member to thread');
                }
              }
            } else {
              logger.debug({ roleId: ADMIN_ROLE_ID }, 'Admin role not found when creating task thread');
            }
          } catch (e) {
            logger.debug({ err: e }, 'Error while inviting admin role members to thread');
          }

          // Intro message in the thread
          await thread.send({
            content: `Private thread created for task ${task.task_id}.
Participants: ${userMention(assignee.id)}, ${userMention(interaction.user.id)}.`,
            embeds: [embed],
          });

          // Update the channel message to include a thread link
          try {
            const channelMsg = await (channel as TextChannel).messages.fetch(sent.id);
            const withThread = new EmbedBuilder(embed.data)
              .addFields({ name: 'Thread', value: `<#${thread.id}>`, inline: false });
            await channelMsg.edit({ embeds: [withThread], components });
          } catch (e) {
            logger.debug({ err: e }, 'Failed to edit channel message with thread link');
          }
        } catch (e) {
          logger.warn({ err: e }, 'Failed to create private task thread');
          warnings.push('Failed to create the private task thread. Ensure the bot has Create Private Threads and Manage Threads permissions.');
        }
      } catch (e) {
        logger.warn({ err: e }, 'Failed to post task in channel');
        warnings.push('Failed to send the task message in the staff channel. Ensure the bot can View Channel and Send Messages.');
      }
    }

    // Patch task with message IDs and thread
    try {
      await updateTask(task.task_id, { 
        dm_message_id: dmMessageId, 
        channel_message_id: channelMessageId, 
        channel_id: channelId,
        thread_id: threadId,
      });
      
      const base = `✅ Task assigned to ${assignee.tag} with ID ${task.task_id}.`;
      const dmNote = dmFailed ? ' Note: DM could not be delivered (user has DMs off or blocked the bot).' : '';
      const warnNote = warnings.length ? `\n\nWarnings:\n- ${warnings.join('\n- ')}` : '';
      await modalInteraction.followUp({
        ephemeral: true,
        content: base + dmNote + warnNote,
      });
    } catch (e) {
      logger.warn({ err: e }, 'Failed to attach message IDs to task');
      const base = `✅ Task assigned to ${assignee.tag} with ID ${task.task_id}, but failed to save message references.`;
      const dmNote = dmFailed ? ' Note: DM could not be delivered (user has DMs off or blocked the bot).' : '';
      const warnNote = warnings.length ? `\n\nWarnings:\n- ${warnings.join('\n- ')}` : '';
      await modalInteraction.followUp({
        ephemeral: true,
        content: base + dmNote + warnNote,
      });
    }
  } catch (e) {
    logger.error({ err: e }, 'Failed to persist task');
    await interaction.followUp({ 
      ephemeral: true,
      content: '❌ Failed to create task. Please try again later.'
    });
  }

}

export async function handleComponent(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.customId.startsWith('task:')) return;

  const parts = interaction.customId.split(':');
  const kind = parts[1];
  const taskId = parts[2];
  // Only assignee can update
  // Quick load of task
  const task = await (await import('../services/appwrite.js')).getTask(taskId);
  if (!task) {
    await interaction.reply({ ephemeral: true, content: 'Task not found.' });
    return;
  }
  if (interaction.user.id !== task.assigned_to) {
    await interaction.reply({ ephemeral: true, content: 'Only the assigned staff can update this task.' });
    return;
  }

  // Safe to acknowledge the interaction and plan to edit the original message
  await interaction.deferUpdate();

  if (kind === 'progress') {
    const val = Number(interaction.values[0]);
    await updateTaskProgress(taskId, val, task.status);
  } else if (kind === 'status') {
    const status = interaction.values[0] as TaskDocument['status'];
    await updateTask(taskId, { status });
  }

  const updated = await (await import('../services/appwrite.js')).getTask(taskId);
  if (!updated) {
    await interaction.reply({ ephemeral: true, content: 'Task updated, but failed to refresh view.' });
    return;
  }

  const embed = taskEmbed(updated);
  const components = buildControls(taskId);

  // Update original message (where the interaction occurred)
  await interaction.editReply({ embeds: [embed], components });

  // Also try to update other mirrors (DM/channel) if we can fetch them
  try {
    if (updated.dm_message_id) {
      const dm = await interaction.user.createDM();
      const msg = await dm.messages.fetch(updated.dm_message_id);
      await msg.edit({ embeds: [embed], components });
    }
  } catch (e) {
    logger.debug({ err: e }, 'Failed to update DM task message');
  }

  try {
    if (updated.channel_id && updated.channel_message_id) {
      const ch = await interaction.client.channels.fetch(updated.channel_id);
      if (ch && ch.isTextBased()) {
        const msg = await (ch as TextChannel).messages.fetch(updated.channel_message_id);
        await msg.edit({ embeds: [embed], components });
      }
    }
  } catch (e) {
    logger.debug({ err: e }, 'Failed to update channel task message');
  }

  // Log the change to the task's private thread
  try {
    if (updated.thread_id) {
      const th = await interaction.client.channels.fetch(updated.thread_id);
      if (th && th.isTextBased()) {
        const actor = interaction.user;
        let log: string;
        if (kind === 'progress') {
          log = `Progress changed: ${task.progress}% -> ${updated.progress}% by ${actor.tag} (${actor.id})`;
        } else {
          log = `Status changed: ${task.status} -> ${updated.status} by ${actor.tag} (${actor.id})`;
        }
        await (th as ThreadChannel).send({ content: log });
      }
    }
  } catch (e) {
    logger.debug({ err: e }, 'Failed to post update to task thread');
  }
}
