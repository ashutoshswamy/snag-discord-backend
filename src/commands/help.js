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
import { getGuildSettings } from '../utils/settingsHelper.js';
import { registerComponentTimeout } from '../utils/componentTimeoutHelper.js';

export async function buildHelpPayload(guildId, page = 'overview') {
  const settings = await getGuildSettings(guildId);
  const roleString = settings.managerRole || 'Giveaway Manager';
  const cleanRole = roleString.replace(/^@/, '').trim();
  const managerRoleText = /^\d+$/.test(cleanRole) ? `<@&${cleanRole}>` : `\`@${cleanRole}\``;

  let prevPage, nextPage;
  if (page === 'overview') {
    prevPage = 'general';
    nextPage = 'giveaways';
  } else if (page === 'giveaways') {
    prevPage = 'overview';
    nextPage = 'general';
  } else {
    prevPage = 'giveaways';
    nextPage = 'overview';
  }

  const helpSelect = new StringSelectMenuBuilder()
    .setCustomId('help_select')
    .setPlaceholder('Navigate help pages…')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('📖 Overview & Info')
        .setDescription('About Snag, permissions, and settings')
        .setValue('overview')
        .setDefault(page === 'overview'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🎊 Giveaway Commands')
        .setDescription('Manage timed giveaways & instant drops')
        .setValue('giveaways')
        .setDefault(page === 'giveaways'),
      new StringSelectMenuOptionBuilder()
        .setLabel('🛠️ General Commands')
        .setDescription('Check latency & view options')
        .setValue('general')
        .setDefault(page === 'general')
    );

  const prevButton = new ButtonBuilder()
    .setCustomId(`help_page_${prevPage}`)
    .setLabel('◀️ Previous')
    .setStyle(ButtonStyle.Secondary);

  const nextButton = new ButtonBuilder()
    .setCustomId(`help_page_${nextPage}`)
    .setLabel('Next ▶️')
    .setStyle(ButtonStyle.Secondary);

  const container = new ContainerBuilder()
    .setAccentColor(0x5865F2); // Discord Blurple

  if (page === 'overview') {
    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 📋  Snag Bot Help — Overview')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `Welcome to **Snag**! A Discord bot designed to run giveaway drawings and instant-claim drops with ease.\n\n` +
          `Use the menu below or the navigation buttons to browse available commands.\n\n` +
          `🛡️ **Permissions & Roles**\n` +
          `• Commands marked with ⚙️ are restricted to the **Server Owner**, members with the **Manage Server** permission, or anyone with the ${managerRoleText} role.\n` +
          `• Commands marked with 👥 are available to all server members.\n\n` +
          `🌐 Visit [snagbot.ashutoshswamy.in](https://snagbot.ashutoshswamy.in) to configure server-specific settings like custom manager roles, logging channels, and embed colors.`
        )
      );
  } else if (page === 'giveaways') {
    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🎊  Giveaway Commands')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '⚙️ **/gstart**\n┗ Starts a timed giveaway with a modal for prize, duration, and winners.\n\n' +
          '⚙️ **/gdrop**\n┗ Launches an instant drop — first to click the claim button wins.\n\n' +
          '⚙️ **/gend**\n┗ Ends an active giveaway early and draws winners immediately.\n\n' +
          '⚙️ **/greroll**\n┗ Selects new random winner(s) from a completed giveaway.\n\n' +
          '👥 **/glist**\n┗ Browses all active giveaways and drops in this server.'
        )
      );
  } else if (page === 'general') {
    container
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent('## 🛠️  General Commands')
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          '👥 **/ping**\n┗ Checks the bot\'s connection status and latency.\n\n' +
          '👥 **/help**\n┗ Shows this list of commands and bot instructions.'
        )
      );
  }

  container
    .addSeparatorComponents(
      new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(helpSelect)
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(prevButton, nextButton)
    );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all available commands and information about Snag'),

  async execute(interaction) {
    const payload = await buildHelpPayload(interaction.guildId, 'overview');
    await interaction.reply(payload);
    const reply = await interaction.fetchReply().catch(() => null);
    if (reply) {
      registerComponentTimeout(reply.id, interaction);
    }
  },
};
