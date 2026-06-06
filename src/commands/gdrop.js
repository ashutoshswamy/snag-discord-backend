import {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { hasManagerPermission } from '../utils/settingsHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('gdrop')
    .setDescription('Launch an instant drop — first to click wins immediately'),

  async execute(interaction) {
    const isManager = await hasManagerPermission(interaction.member, interaction.guildId);
    if (!isManager) {
      return interaction.reply({
        content: '❌ You do not have the required manager role or permissions to run this command.',
        ephemeral: true,
      });
    }

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
