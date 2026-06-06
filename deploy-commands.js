import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('❌ Missing DISCORD_TOKEN or CLIENT_ID.');
  process.exit(1);
}

const commands = [];
const commandsPath = join(__dirname, 'src', 'commands');

for (const file of readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const { default: command } = await import(`./src/commands/${file}`);
  if (command?.data) {
    commands.push(command.data.toJSON());
    console.log(`  📌 Registered: /${command.data.name}`);
  }
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`\nDeploying ${commands.length} global slash command(s)...`);
  const data = await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands }
  );
  console.log(`✅ Successfully deployed ${data.length} command(s) globally.`);
  console.log('   Note: Global commands can take up to 1 hour to propagate.');
} catch (err) {
  console.error('❌ Deploy failed:', err);
  process.exit(1);
}
