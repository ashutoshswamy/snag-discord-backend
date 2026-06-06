import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import supabase from '../supabaseClient.js';
import { getGuildSettings, getLogsChannel } from './settingsHelper.js';

function resolveColor(colorStr, defaultColor) {
  if (!colorStr) return defaultColor;
  if (/^#?[0-9A-F]{6}$/i.test(colorStr)) {
    return colorStr.startsWith('#') ? colorStr : `#${colorStr}`;
  }
  return defaultColor;
}

export function parseDuration(str) {
  const match = str.trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const map = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return val * map[unit];
}

export function buildGiveawayPayload(giveaway, embedColor, messageId = null) {
  const endsAt = new Date(giveaway.ends_at);
  const unixTs = Math.floor(endsAt.getTime() / 1000);
  const color = resolveColor(embedColor, '#9B59B6');

  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 🎊  GIVEAWAY')
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎁  ${giveaway.prize}\n\nClick **Enter Giveaway** below for a chance to win!\nEvery entry counts — good luck! 🍀`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# 🏆 **${giveaway.winner_count}** winner(s)   ·   ⏰ Ends <t:${unixTs}:R>   ·   👤 Hosted by @${giveaway.host_tag}`
      )
    );

  if (messageId) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_join_${messageId}`)
          .setLabel('🎊  Enter Giveaway')
          .setStyle(ButtonStyle.Primary)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildEndedGiveawayPayload(giveaway, winnerMentions, embedColor) {
  const color = resolveColor(embedColor, '#747F8D');
  const winnersText = winnerMentions.length
    ? winnerMentions.join('\n')
    : '*No entries — no winner this time.*';

  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## 🎊  GIVEAWAY ENDED')
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎁  ${giveaway.prize}\n\n🏆  **Winner(s):**\n${winnersText}`
      )
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`giveaway_join_${giveaway.message_id}`)
          .setLabel('🔒  Giveaway Ended')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      )
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function buildDropPayload(drop, claimed = false, claimerTag = null, messageId = null, embedColor) {
  if (claimed) {
    const color = resolveColor(embedColor, '#57F287');
    const container = new ContainerBuilder()
      .setAccentColor(color)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## ✅  DROP CLAIMED')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `### 🎁  ${drop.prize}\n\n🏆  **${claimerTag}** snagged this drop!\nBetter luck next time, everyone else!`
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`drop_claim_${messageId ?? drop.message_id}`)
            .setLabel('✅  Claimed')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        )
      );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const color = resolveColor(embedColor, '#F0B232');
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('## ⚡  INSTANT DROP')
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🎁  ${drop.prize}\n\n⚡  **First come, first served!**\nOne click. One winner. No waiting — move fast!`
      )
    );

  if (messageId) {
    container
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`drop_claim_${messageId}`)
            .setLabel('⚡  Claim Drop')
            .setStyle(ButtonStyle.Success)
        )
      );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

export function selectWinners(entries, count) {
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

export async function endGiveaway(client, giveaway) {
  const { data: entries, error: entriesErr } = await supabase
    .from('entries')
    .select('user_id')
    .eq('message_id', giveaway.message_id);

  if (entriesErr) console.error('[endGiveaway] Entries fetch failed:', entriesErr);

  const winners = selectWinners(entries ?? [], giveaway.winner_count);
  const winnerIds = winners.map(w => w.user_id);
  const winnerMentions = winnerIds.map(id => `<@${id}>`);

  const { error: updateErr } = await supabase
    .from('giveaways')
    .update({ ended: true, winner_ids: winnerIds })
    .eq('message_id', giveaway.message_id);

  if (updateErr) {
    console.error('[endGiveaway] DB update failed:', updateErr);
    return;
  }

  const settings = await getGuildSettings(giveaway.guild_id);
  const embedColor = settings?.embedColor;

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) return;

  const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
  if (message) {
    await message
      .edit(buildEndedGiveawayPayload(giveaway, winnerMentions, embedColor))
      .catch(console.error);
  }

  let targetChannel = channel;
  if (settings?.logsChannel) {
    const logsCh = await getLogsChannel(channel.guild, settings.logsChannel);
    if (logsCh) targetChannel = logsCh;
  }

  if (winners.length > 0) {
    await targetChannel
      .send({ content: `🎊 Congratulations ${winnerMentions.join(', ')}! You won **${giveaway.prize}**! 🎉` })
      .catch(console.error);
  } else {
    await targetChannel
      .send({ content: `📭 No entries for **${giveaway.prize}** — giveaway ended with no winner.` })
      .catch(console.error);
  }
}

export async function checkExpiredGiveaways(client) {
  try {
    const { data: expired, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('ended', false)
      .eq('is_drop', false)
      .lte('ends_at', new Date().toISOString());

    if (error) {
      console.error('[checkExpired] Supabase query failed:', error);
      return;
    }

    for (const giveaway of expired ?? []) {
      await endGiveaway(client, giveaway);
    }
  } catch (err) {
    console.error('[checkExpired] Unexpected error:', err);
  }
}
