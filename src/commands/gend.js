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
        flags: MessageFlags.IsComponentsV2,
        components: [
          new ContainerBuilder()
            .setAccentColor(0x747F8D)
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent('## 📭  No Active Giveaways')
            )
            .addSeparatorComponents(
              new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            )
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(
                'There are no active giveaways to end right now.\n\nStart one with `/gstart`!'
              )
            ),
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

    const components = [
      new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent('## 🗑️  End a Giveaway Early')
        )
        .addSeparatorComponents(
          new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            'Select a giveaway below to end it immediately.\nWinners will be drawn and announced right away.'
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
