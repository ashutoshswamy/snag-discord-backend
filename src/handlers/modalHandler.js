import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import supabase from '../supabaseClient.js';
import { parseDuration, buildGiveawayEmbed, buildDropEmbed } from '../utils/giveawayUtils.js';
import { getGuildSettings } from '../utils/settingsHelper.js';

export async function handleModal(interaction) {
  const { customId } = interaction;

  if (customId === 'gstart_modal') {
    await handleGstartModal(interaction);
  } else if (customId === 'gdrop_modal') {
    await handleGdropModal(interaction);
  }
}

async function handleGstartModal(interaction) {
  const prize = interaction.fields.getTextInputValue('prize').trim();
  const durationStr = interaction.fields.getTextInputValue('duration').trim();
  const winnersRaw = interaction.fields.getTextInputValue('winners').trim();

  const durationMs = parseDuration(durationStr);
  if (!durationMs) {
    return interaction.reply({
      content: '❌ Invalid duration. Use formats like `30s`, `10m`, `2h`, `1d`, or `1w`.',
      ephemeral: true,
    });
  }

  const winnerCount = parseInt(winnersRaw, 10);
  if (isNaN(winnerCount) || winnerCount < 1 || winnerCount > 20) {
    return interaction.reply({
      content: '❌ Winner count must be a number between **1** and **20**.',
      ephemeral: true,
    });
  }

  const settings = await getGuildSettings(interaction.guildId);
  const embedColor = settings?.embedColor;

  const endsAt = new Date(Date.now() + durationMs);
  const giveawayMeta = {
    prize,
    winner_count: winnerCount,
    ends_at: endsAt,
    host_tag: interaction.user.username,
  };

  await interaction.reply({ embeds: [buildGiveawayEmbed(giveawayMeta, embedColor)], components: [] });
  const sentMsg = await interaction.fetchReply();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway_join_${sentMsg.id}`)
      .setLabel('🎊 Enter Giveaway')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.editReply({
    embeds: [buildGiveawayEmbed(giveawayMeta, embedColor)],
    components: [row],
  });

  const { error } = await supabase.from('giveaways').insert({
    message_id: sentMsg.id,
    channel_id: interaction.channelId,
    guild_id: interaction.guildId,
    prize,
    winner_count: winnerCount,
    ends_at: endsAt.toISOString(),
    host_id: interaction.user.id,
    host_tag: interaction.user.username,
    ended: false,
    is_drop: false,
  });

  if (error) {
    console.error('[gstart_modal] DB insert failed:', error);
    await interaction.editReply({
      content: '⚠️ Giveaway posted but failed to save. Contact an admin.',
      components: [],
    });
  }
}

async function handleGdropModal(interaction) {
  const prize = interaction.fields.getTextInputValue('prize').trim();

  const settings = await getGuildSettings(interaction.guildId);
  const embedColor = settings?.embedColor;

  await interaction.reply({ embeds: [buildDropEmbed({ prize }, false, null, embedColor)], components: [] });
  const sentMsg = await interaction.fetchReply();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`drop_claim_${sentMsg.id}`)
      .setLabel('⚡ Claim Drop')
      .setStyle(ButtonStyle.Success)
  );

  await interaction.editReply({
    embeds: [buildDropEmbed({ prize }, false, null, embedColor)],
    components: [row],
  });

  const expiresAt = new Date(Date.now() + 86_400_000);

  const { error } = await supabase.from('giveaways').insert({
    message_id: sentMsg.id,
    channel_id: interaction.channelId,
    guild_id: interaction.guildId,
    prize,
    winner_count: 1,
    ends_at: expiresAt.toISOString(),
    host_id: interaction.user.id,
    host_tag: interaction.user.username,
    ended: false,
    is_drop: true,
  });

  if (error) {
    console.error('[gdrop_modal] DB insert failed:', error);
    await interaction.editReply({
      content: '⚠️ Drop posted but failed to save. Contact an admin.',
      components: [],
    });
  }
}
