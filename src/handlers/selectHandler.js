import supabase from '../supabaseClient.js';
import { endGiveaway, selectWinners } from '../utils/giveawayUtils.js';
import { buildGlistEmbed } from '../commands/glist.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export async function handleSelect(interaction) {
  const { customId } = interaction;

  if (customId === 'gend_select') {
    await handleGendSelect(interaction);
  } else if (customId === 'greroll_select') {
    await handleGrerollSelect(interaction);
  }
}

async function handleGendSelect(interaction) {
  await interaction.deferUpdate();

  const messageId = interaction.values[0];

  const { data: giveaway, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('message_id', messageId)
    .eq('guild_id', interaction.guildId)
    .eq('ended', false)
    .eq('is_drop', false)
    .maybeSingle();

  if (error) {
    console.error('[gend_select] DB query failed:', error);
    return interaction.editReply({ content: '❌ Database error. Try again.', components: [] });
  }

  if (!giveaway) {
    return interaction.editReply({
      content: '❌ Giveaway not found or already ended.',
      components: [],
    });
  }

  await endGiveaway(interaction.client, giveaway);
  await interaction.editReply({
    content: `✅ **${giveaway.prize}** has been ended — winners announced!`,
    embeds: [],
    components: [],
  });
}

async function handleGrerollSelect(interaction) {
  await interaction.deferUpdate();

  const messageId = interaction.values[0];

  const { data: giveaway, error: gErr } = await supabase
    .from('giveaways')
    .select('*')
    .eq('message_id', messageId)
    .eq('guild_id', interaction.guildId)
    .maybeSingle();

  if (gErr) {
    console.error('[greroll_select] DB query failed:', gErr);
    return interaction.editReply({ content: '❌ Database error. Try again.', components: [] });
  }

  if (!giveaway) {
    return interaction.editReply({
      content: '❌ Giveaway not found.',
      components: [],
    });
  }

  const { data: entries, error: eErr } = await supabase
    .from('entries')
    .select('user_id')
    .eq('message_id', messageId);

  if (eErr) {
    console.error('[greroll_select] Entries fetch failed:', eErr);
    return interaction.editReply({ content: '❌ Failed to fetch entries.', components: [] });
  }

  if (!entries?.length) {
    return interaction.editReply({
      content: '📭 No entries found for this giveaway — nothing to reroll.',
      components: [],
    });
  }

  const winners = selectWinners(entries, giveaway.winner_count);
  const mentions = winners.map(w => `<@${w.user_id}>`).join(', ');

  await interaction.editReply({
    content: `🎊 Reroll complete! New winner(s) for **${giveaway.prize}**: ${mentions} — congratulations!`,
    embeds: [],
    components: [],
  });
}

export async function handleGlistButton(interaction) {
  const { customId } = interaction;

  const filterMap = {
    glist_filter_all: 'all',
    glist_filter_giveaway: 'giveaway',
    glist_filter_drop: 'drop',
  };

  const filter = filterMap[customId] ?? 'all';

  await interaction.deferUpdate();

  const { data: giveaways, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('guild_id', interaction.guildId)
    .eq('ended', false)
    .order('ends_at', { ascending: true });

  if (error) {
    console.error('[glist_button] DB query failed:', error);
    return interaction.editReply({ content: '❌ Failed to fetch giveaways.' });
  }

  const styles = f => (f === filter ? ButtonStyle.Primary : ButtonStyle.Secondary);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('glist_filter_all').setLabel('📋 All').setStyle(styles('all')),
    new ButtonBuilder().setCustomId('glist_filter_giveaway').setLabel('🎊 Giveaways').setStyle(styles('giveaway')),
    new ButtonBuilder().setCustomId('glist_filter_drop').setLabel('⚡ Drops').setStyle(styles('drop')),
    new ButtonBuilder().setCustomId('glist_refresh').setLabel('🔄 Refresh').setStyle(ButtonStyle.Secondary)
  );

  await interaction.editReply({
    ...buildGlistEmbed(giveaways ?? [], filter),
    components: [row],
  });
}
