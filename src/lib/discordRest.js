const DISCORD_API = 'https://discord.com/api/v10';

// Simple per-token cache to avoid hammering Discord's rate limit
const guildsCache = new Map(); // token -> { data, expiresAt }
const GUILDS_CACHE_TTL = 10_000; // 10 seconds

export async function getUserGuilds(accessToken) {
  const cached = guildsCache.get(accessToken);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 429) {
    const { retry_after } = await res.json();
    await new Promise(r => setTimeout(r, (retry_after + 0.1) * 1000));
    return getUserGuilds(accessToken); // retry once
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API ${res.status}: ${body}`);
  }

  const data = await res.json();
  guildsCache.set(accessToken, { data, expiresAt: Date.now() + GUILDS_CACHE_TTL });
  return data;
}

export async function getGuildChannels(guildId) {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}: failed to fetch channels`);
  const channels = await res.json();
  return channels
    .filter(c => c.type === 0)
    .sort((a, b) => a.position - b.position);
}

export async function postMessage(channelId, body) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json();
}

export async function editMessage(channelId, messageId, body) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API ${res.status}: ${text}`);
  }
  return res.json();
}

export function hasManageGuild(permissions) {
  return (BigInt(permissions ?? '0') & 0x20n) !== 0n;
}

export function parseDuration(str) {
  const match = str.trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) return null;
  const val = parseInt(match[1], 10);
  const map = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return val * map[match[2].toLowerCase()];
}

export function buildGiveawayPayload(messageId, { prize, winnerCount, endsAt, hostTag }) {
  const unixTs = Math.floor(new Date(endsAt).getTime() / 1000);
  const payload = {
    embeds: [{
      title: '🎊  G I V E A W A Y',
      color: 0x9B59B6,
      description: `>>> 🎁  **${prize}**\n\nClick **Enter Giveaway** below for a chance to win!\nEvery entry counts — good luck! 🍀`,
      fields: [
        { name: '🏆  Winners', value: `**${winnerCount}**`, inline: true },
        { name: '⏰  Ends', value: `<t:${unixTs}:R>`, inline: true },
        { name: '👤  Hosted by', value: `@${hostTag}`, inline: true },
      ],
      footer: { text: '🎲 Snag  •  Click the button below to enter!' },
      timestamp: new Date(endsAt).toISOString(),
    }],
  };
  if (messageId) {
    payload.components = [{
      type: 1,
      components: [{
        type: 2, style: 1,
        custom_id: `giveaway_join_${messageId}`,
        label: '🎊 Enter Giveaway',
      }],
    }];
  }
  return payload;
}

export function buildDropPayload(messageId, { prize }) {
  const payload = {
    embeds: [{
      title: '⚡  INSTANT DROP',
      color: 0xF0B232,
      description: `>>> 🎁  **${prize}**\n\n⚡  **First come, first served!**\nOne click. One winner. No waiting — move fast!`,
      footer: { text: 'Snag  •  Be the fastest!' },
      timestamp: new Date().toISOString(),
    }],
  };
  if (messageId) {
    payload.components = [{
      type: 1,
      components: [{
        type: 2, style: 3,
        custom_id: `drop_claim_${messageId}`,
        label: '⚡ Claim Drop',
      }],
    }];
  }
  return payload;
}

export function buildEndedEmbedPayload(giveaway, winnerMentions) {
  const winnersText = winnerMentions.length
    ? winnerMentions.join('\n')
    : '*No entries — no winner this time.*';
  return {
    embeds: [{
      title: '🎊  GIVEAWAY ENDED',
      color: 0x747F8D,
      description: `>>> 🎁  **${giveaway.prize}**\n\n🏆  **Winner(s):**\n${winnersText}`,
      footer: { text: 'Snag  •  Giveaway concluded' },
      timestamp: new Date(giveaway.ends_at).toISOString(),
    }],
    components: [{
      type: 1,
      components: [{
        type: 2, style: 2,
        custom_id: `giveaway_join_${giveaway.message_id}`,
        label: '🔒  Giveaway Ended',
        disabled: true,
      }],
    }],
  };
}

export function pickWinners(entries, count) {
  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}
