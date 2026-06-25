import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('gdrop')
    .setDescription('Launch an instant drop — first to click wins immediately'),

  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('gdrop_modal')
      .setTitle('⚡ Create Instant Drop');

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prize')
          .setLabel('Prize')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. Nitro Classic, $10 Steam Gift Card…')
          .setRequired(true)
          .setMaxLength(100)
      )
    );

    await interaction.showModal(modal);
  },
};
