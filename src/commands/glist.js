import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import supabase from '../supabaseClient.js';

export function buildGlistEmbed(giveaways, filter = 'all') {
  const filtered = giveaways.filter(g => {
    if (filter === 'giveaway') return !g.is_drop;
    if (filter === 'drop') return g.is_drop;
    return true;
  });

  const title =
    filter === 'giveaway' ? '🎊  Active Giveaways' :
    filter === 'drop'     ? '⚡  Active Drops' :
                            '📋  Active Giveaways & Drops';

  if (!filtered.length) {
    return {
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setColor(0x5865F2)
          .setDescription(
            `*Nothing active right now.*\n\nStart one with \`/gstart\` or \`/gdrop\`!`
          )
          .setFooter({ text: 'Snag  •  Giveaway Manager' })
          .setTimestamp(),
      ],
    };
  }

  const lines = filtered.map(g => {
    const jumpUrl = `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}`;
    const unixTs = Math.floor(new Date(g.ends_at).getTime() / 1000);
    const typeIcon = g.is_drop ? '⚡' : '🎊';
    const badge = g.is_drop ? '`Drop`' : `\`${g.winner_count}W\``;
    return `${typeIcon}  **${g.prize}** ${badge}\n┗ Ends <t:${unixTs}:R>  •  [Jump ↗](${jumpUrl})`;
  });

  return {
    embeds: [
      new EmbedBuilder()
        .setTitle(title)
        .setColor(0x5865F2)
        .setDescription(lines.join('\n\n'))
        .setFooter({ text: `${filtered.length} active  •  Snag` })
        .setTimestamp(),
    ],
  };
}

function buildFilterRow(active = 'all') {
  const styles = f => (f === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('glist_filter_all')
      .setLabel('📋 All')
      .setStyle(styles('all')),
    new ButtonBuilder()
      .setCustomId('glist_filter_giveaway')
      .setLabel('🎊 Giveaways')
      .setStyle(styles('giveaway')),
    new ButtonBuilder()
      .setCustomId('glist_filter_drop')
      .setLabel('⚡ Drops')
      .setStyle(styles('drop')),
    new ButtonBuilder()
      .setCustomId('glist_refresh')
      .setLabel('🔄 Refresh')
      .setStyle(ButtonStyle.Secondary)
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('glist')
    .setDescription('Browse all active giveaways and drops in this server'),

  async execute(interaction) {
    await interaction.deferReply();

    const { data: giveaways, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('guild_id', interaction.guildId)
      .eq('ended', false)
      .order('ends_at', { ascending: true });

    if (error) {
      console.error('[glist] DB query failed:', error);
      return interaction.editReply({ content: '❌ Failed to fetch giveaways. Try again.' });
    }

    await interaction.editReply({
      ...buildGlistEmbed(giveaways ?? [], 'all'),
      components: [buildFilterRow('all')],
    });
  },
};
