import 'dotenv/config';

// L-1: validate all required env vars before any service initializes
const REQUIRED_ENV = ['DISCORD_TOKEN', 'JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'CLIENT_ID', 'DISCORD_REDIRECT_URI'];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// L-2: warn loudly if FRONTEND_URL not set in production
if (!process.env.FRONTEND_URL && process.env.NODE_ENV === 'production') {
  console.error('❌ FRONTEND_URL is not set in production environment.');
  process.exit(1);
}

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleButton } from './src/handlers/buttonHandler.js';
import { handleModal } from './src/handlers/modalHandler.js';
import { handleSelect, handleGlistRefreshButton } from './src/handlers/selectHandler.js';
import { checkExpiredGiveaways } from './src/utils/giveawayUtils.js';
import apiRouter from './src/api/router.js';

const __dirname_api = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.commands = new Collection();

const app = express();
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

// Attach Discord client to requests
app.use((req, res, next) => {
  req.discordClient = client;
  next();
});

app.use('/api', apiRouter);

app.get('/health', (_, res) => res.send('OK'));
app.listen(PORT, () => console.log(`🌐 API server listening on port ${PORT}`));

const __dirname = __dirname_api;

// Load all command modules from src/commands/
const commandsPath = join(__dirname, 'src', 'commands');
for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const { default: command } = await import(`./src/commands/${file}`);
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  }
}

function setPresence(c) {
  c.user.setPresence({ activities: [{ name: 'snagbot.ashutoshswamy.in', type: 3 }], status: 'online' });
}

client.once(Events.ClientReady, c => {
  console.log(`✅ Logged in as ${c.user.tag} (${c.user.id})`);
  console.log(`📦 Loaded ${client.commands.size} command(s).`);

  setPresence(c);

  // Poll for expired giveaways every 15 seconds
  setInterval(() => checkExpiredGiveaways(client), 15_000);
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelect(interaction);
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith('glist_refresh_')) {
        await handleGlistRefreshButton(interaction);
      } else {
        await handleButton(interaction);
      }
    }
  } catch (err) {
    console.error(`[InteractionCreate] Unhandled error for ${interaction.type}:`, err);
    const payload = { content: '⚠️ Something went wrong. Please try again.', ephemeral: true };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch {
      // Interaction already expired — nothing to do
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
