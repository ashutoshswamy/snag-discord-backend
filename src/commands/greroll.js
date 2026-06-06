import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import supabase from '../supabaseClient.js';
import { hasManagerPermission } from '../utils/settingsHelper.js';
import { registerComponentTimeout } from '../utils/componentTimeoutHelper.js';

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
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x747F8D)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent('## 📭  No Ended Giveaways')
            )
            .addSeparatorComponents(
              new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                'No completed giveaways or drops found in this server.'
              )
            ),
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

    const components = [
      new ContainerBuilder()
        .setAccentColor(0x9B59B6)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 🎲  Reroll a Giveaway')
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            'Select a completed giveaway below to draw new winner(s).\nNew winners are chosen randomly from all entries.'
          )
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
        )
        .addActionRowComponents(
          new ActionRowBuilder().addComponents(select)
        ),
    ];

    const reply = await interaction.editReply({
      flags: MessageFlags.IsComponentsV2,
      components,
    });
    if (reply) {
      registerComponentTimeout(reply.id, interaction, components);
    }
  },
};
