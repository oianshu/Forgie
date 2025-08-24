import type { GuildMember, Role } from 'discord.js';

export function formatDate(date?: Date | null): string {
  if (!date) return 'Unknown';
  return `<t:${Math.floor(date.getTime() / 1000)}:D>`;
}

export function getTopRole(member: GuildMember): Role | null {
  const role = member.roles.highest;
  if (!role || role.id === member.guild.roles.everyone.id) return null;
  return role;
}
