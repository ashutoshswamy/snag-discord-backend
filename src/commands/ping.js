import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription("Check the bot's latency and connection status"),

  async execute(interaction) {
    const wsPing = Math.round(interaction.client.ws.ping);
    const apiPing = Date.now() - interaction.createdTimestamp;

    // Determine color and status message based on latency
    let statusEmoji = '🟢';
    let color = 0x57F287; // Discord Green
    if (wsPing > 250 || apiPing > 350) {
      statusEmoji = '🟡';
      color = 0xFEE75C; // Discord Yellow
    } else if (wsPing > 500 || apiPing > 700) {
      statusEmoji = '🔴';
      color = 0xED4245; // Discord Red
    }

    const container = new ContainerBuilder()
      .setAccentColor(color)
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${statusEmoji}  Bot Latency`)
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `📡  **WebSocket Ping:** \`${wsPing}ms\`\n` +
          `⚡  **API Latency:** \`${apiPing}ms\``
        )
      )
      .addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
      )
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# Connection is healthy and active.  •  Snag`)
      );

    await interaction.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container],
    });
  },
};
