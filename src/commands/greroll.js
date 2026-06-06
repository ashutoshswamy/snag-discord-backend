import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import supabase from '../supabaseClient.js';
import { hasManagerPermission } from '../utils/settingsHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('greroll')
    .setDescription('Pick new winner(s) for a completed giveaway'),

  async execute(interaction) {
    const isManager = await hasManagerPermission(interaction.member, interaction.guildId);
    if (!isManager) {
      return interaction.reply({
        content: '❌ You do not have the required manager role or permissions to run this command.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const { data: giveaways, error } = await supabase
      .from('giveaways')
      .select('*')
      .eq('guild_id', interaction.guildId)
      .eq('ended', true)
      .order('ends_at', { ascending: false })
      .limit(25);

    if (error) {
      console.error('[greroll] DB query failed:', error);
      return interaction.editReply({ content: '❌ Database error. Try again.' });
    }

    if (!giveaways?.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📭 No Ended Giveaways')
            .setColor(0x747F8D)
            .setDescription('No completed giveaways or drops found in this server.')
            .setFooter({ text: 'Snag  •  Giveaway Manager' }),
        ],
      });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('greroll_select')
      .setPlaceholder('Select a giveaway to reroll…')
      .addOptions(
        giveaways.map(g => {
          const typeLabel = g.is_drop ? 'Drop' : 'Giveaway';
          return new StringSelectMenuOptionBuilder()
            .setLabel(g.prize.slice(0, 100))
            .setDescription(`${typeLabel}  •  ${g.winner_count} winner(s)`.slice(0, 100))
            .setValue(g.message_id)
            .setEmoji(g.is_drop ? '⚡' : '🎲');
        })
      );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🎲  Reroll a Giveaway')
          .setColor(0x9B59B6)
          .setDescription(
            'Select a completed giveaway below to draw new winner(s).\nNew winners are chosen randomly from all entries.'
          )
          .setFooter({ text: 'Snag  •  Giveaway Manager' }),
      ],
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },
};
