import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { getGuildSettings } from '../utils/settingsHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands and information about Snag'),

  async execute(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    const roleString = settings.managerRole || 'Giveaway Manager';
    const cleanRole = roleString.replace(/^@/, '').trim();
    const managerRoleText = /^\d+$/.test(cleanRole) ? `<@&${cleanRole}>` : `\`@${cleanRole}\``;

    const container = new ContainerBuilder()
      .setAccentColor(0x5865F2) // Discord Blurple
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 📋  Snag Command Help')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 🎊  Giveaway Commands\n' +
          '⚙️ **/gstart**\n┗ Starts a timed giveaway with a modal for prize, duration, and winners.\n\n' +
          '⚙️ **/gdrop**\n┗ Launches an instant drop — first to click the claim button wins.\n\n' +
          '⚙️ **/gend**\n┗ Ends an active giveaway early and draws winners immediately.\n\n' +
          '⚙️ **/greroll**\n┗ Selects new random winner(s) from a completed giveaway.\n\n' +
          '👥 **/glist**\n┗ Browses all active giveaways and drops in this server.'
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '### 🛠️  General Commands\n' +
          '👥 **/ping**\n┗ Checks the bot\'s connection status and latency.\n\n' +
          '👥 **/help**\n┗ Shows this list of commands and bot instructions.'
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `🛡️ **Permissions & Roles**\n` +
          `• Commands marked with ⚙️ are restricted to the **Server Owner**, members with the **Manage Server** permission, or anyone with the ${managerRoleText} role.\n` +
          `• Commands marked with 👥 are available to all server members.\n\n` +
          `🌐 Visit [snagbot.ashutoshswamy.in](https://snagbot.ashutoshswamy.in) to configure server-specific settings like custom manager roles, logging channels, and embed colors.`
        )
      );

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });
  },
};
