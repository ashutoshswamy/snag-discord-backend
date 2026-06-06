import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import supabase from '../supabaseClient.js';

export function buildGlistPayload(giveaways, filter = 'all') {
  const filtered = giveaways.filter(g => {
    if (filter === 'giveaway') return !g.is_drop;
    if (filter === 'drop') return g.is_drop;
    return true;
  });

  const title =
    filter === 'giveaway' ? '## 🎊  Active Giveaways' :
    filter === 'drop'     ? '## ⚡  Active Drops' :
                            '## 📋  Active Giveaways & Drops';

  const filterSelect = new StringSelectMenuBuilder()
    .setCustomId('glist_filter')
    .setPlaceholder('Filter by type…')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('📋  All')
        .setDescription('Show all active giveaways and drops')
        .setValue('all')
        .setDefault(filter === 'all'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🎊  Giveaways')
        .setDescription('Show timed giveaways only')
        .setValue('giveaway')
        .setDefault(filter === 'giveaway'),
      new StringSelectMenuOptionBuilder()
        .setLabel('⚡  Drops')
        .setDescription('Show instant drops only')
        .setValue('drop')
        .setDefault(filter === 'drop')
    );

  const refreshButton = new ButtonBuilder()
    .setCustomId(`glist_refresh_${filter}`)
    .setLabel('🔄  Refresh')
    .setStyle(ButtonStyle.Secondary);

  const container = new ContainerBuilder()
    .setAccentColor(0x5865F2)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

  if (!filtered.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        '*Nothing active right now.*\n\nStart one with `/gstart` or `/gdrop`!'
      )
    );
  } else {
    const lines = filtered.map(g => {
      const jumpUrl = `https://discord.com/channels/${g.guild_id}/${g.channel_id}/${g.message_id}`;
      const unixTs = Math.floor(new Date(g.ends_at).getTime() / 1000);
      const typeIcon = g.is_drop ? '⚡' : '🎊';
      const badge = g.is_drop ? '`Drop`' : `\`${g.winner_count}W\``;
      return `${typeIcon}  **${g.prize}** ${badge}\n┗ Ends <t:${unixTs}:R>  •  [Jump ↗](${jumpUrl})`;
    });

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join('\n\n'))
    );

    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${filtered.length} active  •  Snag`)
    );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(filterSelect)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(refreshButton)
    );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
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

    await interaction.editReply(buildGlistPayload(giveaways ?? [], 'all'));
  },
};
