import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import supabase from '../supabaseClient.js';
import { endGiveaway, selectWinners } from '../utils/giveawayUtils.js';
import { buildGlistPayload } from '../commands/glist.js';

export async function handleSelect(interaction) {
  const { customId } = interaction;

  if (customId === 'gend_select') {
    await handleGendSelect(interaction);
  } else if (customId === 'greroll_select') {
    await handleGrerollSelect(interaction);
  } else if (customId === 'glist_filter') {
    await handleGlistFilter(interaction);
  }
}

export async function handleGlistRefreshButton(interaction) {
  // customId format: glist_refresh_<filter>
  const filter = interaction.customId.replace('glist_refresh_', '') || 'all';
  await interaction.deferUpdate();

  const { data: giveaways, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('guild_id', interaction.guildId)
    .eq('ended', false)
    .order('ends_at', { ascending: true });

  if (error) {
    console.error('[glist_refresh] DB query failed:', error);
    return interaction.editReply({ content: '❌ Failed to fetch giveaways.' });
  }

  await interaction.editReply(buildGlistPayload(giveaways ?? [], filter));
}

async function handleGlistFilter(interaction) {
  const filter = interaction.values[0];
  await interaction.deferUpdate();

  const { data: giveaways, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('guild_id', interaction.guildId)
    .eq('ended', false)
    .order('ends_at', { ascending: true });

  if (error) {
    console.error('[glist_filter] DB query failed:', error);
    return interaction.editReply({ content: '❌ Failed to fetch giveaways.' });
  }

  await interaction.editReply(buildGlistPayload(giveaways ?? [], filter));
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
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor('#ED4245')
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('❌ Giveaway not found or already ended.')
          ),
      ],
    });
  }

  await endGiveaway(interaction.client, giveaway);

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor('#57F287')
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## ✅  Giveaway Ended')
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**${giveaway.prize}** has been ended — winners announced!`
          )
        ),
    ],
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
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor('#ED4245')
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('❌ Giveaway not found.')
          ),
      ],
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
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder()
          .setAccentColor('#747F8D')
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              '📭 No entries found for this giveaway — nothing to reroll.'
            )
          ),
      ],
    });
  }

  const winners = selectWinners(entries, giveaway.winner_count);
  const mentions = winners.map(w => `<@${w.user_id}>`).join(', ');

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor('#9B59B6')
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 🎲  Reroll Complete!')
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `New winner(s) for **${giveaway.prize}**:\n\n${mentions}\n\nCongratulations! 🎉`
          )
        ),
    ],
  });
}
