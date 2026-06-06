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
    .setName('gend')
    .setDescription('End an active giveaway early and pick winners immediately'),

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
      .eq('ended', false)
      .eq('is_drop', false)
      .order('ends_at', { ascending: true })
      .limit(25);

    if (error) {
      console.error('[gend] DB query failed:', error);
      return interaction.editReply({ content: '❌ Database error. Try again.' });
    }

    if (!giveaways?.length) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle('📭 No Active Giveaways')
            .setColor(0x747F8D)
            .setDescription('There are no active giveaways to end right now.')
            .setFooter({ text: 'Snag  •  Giveaway Manager' }),
        ],
      });
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId('gend_select')
      .setPlaceholder('Select a giveaway to end early…')
      .addOptions(
        giveaways.map(g => {
          const endsAt = new Date(g.ends_at);
          const dateStr = endsAt.toLocaleString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          return new StringSelectMenuOptionBuilder()
            .setLabel(g.prize.slice(0, 100))
            .setDescription(`${g.winner_count} winner(s)  •  Ends ${dateStr}`.slice(0, 100))
            .setValue(g.message_id)
            .setEmoji('🎊');
        })
      );

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🗑️  End a Giveaway Early')
          .setColor(0xED4245)
          .setDescription(
            'Select a giveaway below to end it immediately.\nWinners will be drawn and announced right away.'
          )
          .setFooter({ text: 'Snag  •  Giveaway Manager' }),
      ],
      components: [new ActionRowBuilder().addComponents(select)],
    });
  },
};
