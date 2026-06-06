import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PermissionFlagsBits } from 'discord.js';
import supabase from '../supabaseClient.js';

const SETTINGS_FILE = join(process.cwd(), 'src', 'api', 'settings.json');

function getLocalSettings(guildId) {
  try {
    if (!existsSync(SETTINGS_FILE)) {
      return { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
    }
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return data[guildId] || { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
  } catch {
    return { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
  }
}

export async function getGuildSettings(guildId) {
  if (!guildId) {
    return { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
  }
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (!error && data) {
      return {
        managerRole: data.manager_role,
        logsChannel: data.logs_channel,
        embedColor: data.embed_color,
        telemetry: data.telemetry,
      };
    }
  } catch (err) {
    console.log(`[getGuildSettings] Supabase settings fetch failed, using local fallback: ${err.message}`);
  }
  return getLocalSettings(guildId);
}

export async function hasManagerPermission(member, guildId) {
  if (!member) return false;

  // Server owner always has permission
  if (member.guild.ownerId === member.id) return true;

  // Manage Guild permission always has permission
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;

  const settings = await getGuildSettings(guildId);
  const managerRoleSetting = settings.managerRole;
  if (!managerRoleSetting) return false;

  const cleanRole = managerRoleSetting.replace(/^@/, '').trim();
  if (!cleanRole) return false;

  // If cleanRole is numeric, check by ID
  if (/^\d+$/.test(cleanRole)) {
    return member.roles.cache.has(cleanRole);
  }

  // Name-based matching: any server member who can create a role with this name gains access.
  // Prefer configuring a role ID instead.
  console.warn(`[hasManagerPermission] Guild ${guildId}: matching manager role by name "${cleanRole}" — use a role ID for stricter control.`);
  return member.roles.cache.some(role => role.name.toLowerCase() === cleanRole.toLowerCase());
}

export async function getLogsChannel(guild, logsChannelSetting) {
  if (!logsChannelSetting || !guild) return null;
  const cleanChannel = logsChannelSetting.replace(/^#/, '').trim();
  if (!cleanChannel) return null;

  // Try fetching by ID if it's numeric
  if (/^\d+$/.test(cleanChannel)) {
    const ch = await guild.channels.fetch(cleanChannel).catch(() => null);
    if (ch) return ch;
  }

  // Otherwise try finding it by name in guild.channels.cache
  const cachedCh = guild.channels.cache.find(
    ch => ch.name.toLowerCase() === cleanChannel.toLowerCase() && ch.isTextBased()
  );
  if (cachedCh) return cachedCh;

  // If not found in cache, fetch all channels and look up
  const fetchedChannels = await guild.channels.fetch().catch(() => null);
  if (fetchedChannels) {
    const found = fetchedChannels.find(
      ch => ch.name.toLowerCase() === cleanChannel.toLowerCase() && ch.isTextBased()
    );
    if (found) return found;
  }
  return null;
}
