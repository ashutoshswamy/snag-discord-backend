import {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  resolveColor,
} from 'discord.js';
import supabase from '../supabaseClient.js';
import { buildDropPayload } from '../utils/giveawayUtils.js';
import { getGuildSettings, getLogsChannel } from '../utils/settingsHelper.js';
import { buildHelpPayload } from '../commands/help.js';
import { extendComponentTimeout } from '../utils/componentTimeoutHelper.js';

export async function handleButton(interaction) {
  const { customId } = interaction;

  if (customId.startsWith('giveaway_join_')) {
    await handleGiveawayJoin(interaction);
  } else if (customId.startsWith('drop_claim_')) {
    await handleDropClaim(interaction);
  } else if (customId.startsWith('help_page_')) {
    await handleHelpPageButton(interaction);
  }
}

async function handleHelpPageButton(interaction) {
  const page = interaction.customId.replace('help_page_', '');
  await interaction.deferUpdate();
  const payload = await buildHelpPayload(interaction.guildId, page);
  await interaction.editReply(payload);
  extendComponentTimeout(interaction.message.id, interaction);
}

async function handleGiveawayJoin(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const messageId = interaction.customId.slice('giveaway_join_'.length);

  const { data: giveaway, error: gErr } = await supabase
    .from('giveaways')
    .select('prize, ended')
    .eq('message_id', messageId)
    .maybeSingle();

  if (gErr) {
    console.error('[buttonHandler] Giveaway lookup failed:', gErr);
    return interaction.editReply({ content: '❌ Could not verify giveaway. Try again.' });
  }

  if (!giveaway || giveaway.ended) {
    return interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components: [
        new ContainerBuilder().addTextDisplayComponents(
          new TextDisplayBuilder().setContent('⏰ This giveaway has already ended.')
        ),
      ],
    });
  }

  const { error: insertErr } = await supabase.from('entries').insert({
    message_id: messageId,
    user_id: interaction.user.id,
    guild_id: interaction.guildId,
  });

  if (insertErr) {
    if (insertErr.code === '23505') {
      return interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x9B59B6)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                `🎉 You're already entered! Fingers crossed for **${giveaway.prize}**! 🍀`
              )
            ),
        ],
      });
    }
    console.error('[buttonHandler] Entry insert failed:', insertErr);
    return interaction.editReply({ content: '❌ Failed to register entry. Try again.' });
  }

  await interaction.editReply({
    flags: MessageFlags.IsComponentsV2,
    components: [
      new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `✅ You're in! Good luck winning **${giveaway.prize}**! 🍀`
          )
        ),
    ],
  });
}

async function handleDropClaim(interaction) {
  await interaction.deferUpdate();

  const messageId = interaction.customId.slice('drop_claim_'.length);

  const { data: drop, error } = await supabase
    .from('giveaways')
    .update({ ended: true, winner_ids: [interaction.user.id] })
    .eq('message_id', messageId)
    .eq('ended', false)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[buttonHandler] Drop claim update failed:', error);
    return interaction.followUp({ content: '❌ An error occurred. Try again.', ephemeral: true });
  }

  if (!drop) {
    return interaction.followUp({
      content: '⚡ Someone else was faster — this drop is gone!',
      ephemeral: true,
    });
  }

  await supabase.from('entries').insert({
    message_id: messageId,
    user_id: interaction.user.id,
    guild_id: interaction.guildId,
  });

  const settings = await getGuildSettings(interaction.guildId);
  const embedColor = settings?.embedColor;

  await interaction.editReply(
    buildDropPayload(drop, true, interaction.user.username, messageId, embedColor)
  );

  let targetChannel = interaction.channel;
  if (settings?.logsChannel) {
    const logsCh = await getLogsChannel(interaction.guild, settings.logsChannel);
    if (logsCh) targetChannel = logsCh;
  }

  if (targetChannel.id === interaction.channelId) {
    await interaction.followUp({
      content: `⚡ <@${interaction.user.id}> snagged **${drop.prize}**! Congratulations! 🎊`,
    });
  } else {
    await targetChannel.send({
      content: `⚡ <@${interaction.user.id}> snagged **${drop.prize}** in <#${interaction.channelId}>! Congratulations! 🎊`,
    }).catch(console.error);
  }
}
