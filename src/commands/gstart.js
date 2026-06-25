import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('gstart')
    .setDescription('Start a timed giveaway with automatic winner selection'),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('gstart_modal')
      .setTitle('🎊 Start a Giveaway');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('Prize')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Nitro Classic, $10 Steam Gift Card…')
          .setRequired(true)
          .setMaxLength(100)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('duration')
          .setLabel('Duration')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 30m, 1h, 2d, 1w')
          .setRequired(true)
          .setMaxLength(10)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('winners')
          .setLabel('Number of Winners (1–20)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1')
          .setRequired(true)
          .setMaxLength(2)
      )
    );

    await interaction.showModal(modal);
  },
};
