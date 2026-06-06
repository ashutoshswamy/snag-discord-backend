import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import jwt from 'jsonwebtoken';
import supabase from '../supabaseClient.js';
import {
  getUserGuilds, hasManageGuild, getGuildChannels,
  postMessage, editMessage, parseDuration,
  buildGiveawayPayload, buildDropPayload,
  buildEndedEmbedPayload, pickWinners,
} from '../lib/discordRest.js';
import { getGuildSettings } from '../utils/settingsHelper.js';

const router = Router();
const DISCORD_API = 'https://discord.com/api/v10';
const JWT_SECRET = process.env.JWT_SECRET || 'changeme-set-JWT_SECRET-in-env';
const COOKIE_NAME = 'snag_session';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'none',
  secure: true,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

function verifyToken(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function requireAuth(req, res, next) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  next();
}

// ── Auth ────────────────────────────────────────────────────────────────────

router.get('/auth/discord', (req, res) => {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

router.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect(`${FRONTEND_URL}/?error=no_code`);

  try {
    const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[OAuth callback] Token exchange failed:', err);
      return res.redirect(`${FRONTEND_URL}/?error=token_exchange`);
    }

    const { access_token } = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = await userRes.json();

    const payload = {
      accessToken: access_token,
      discordId: user.id,
      name: user.username,
      globalName: user.global_name || user.username,
      avatar: user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`,
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.cookie(COOKIE_NAME, token, COOKIE_OPTS);
    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (err) {
    console.error('[OAuth callback] Unexpected error:', err);
    res.redirect(`${FRONTEND_URL}/?error=server`);
  }
});

router.get('/auth/me', (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { accessToken, ...safe } = user;
  res.json(safe);
});

router.post('/auth/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ── Guilds ───────────────────────────────────────────────────────────────────

router.get('/guilds', requireAuth, async (req, res) => {
  let allGuilds;
  try {
    allGuilds = await getUserGuilds(req.user.accessToken);
  } catch (err) {
    console.error('[GET /api/guilds]', err.message);
    return res.status(502).json({ error: 'Failed to fetch Discord guilds', detail: err.message });
  }

  const managed = allGuilds.filter(g => hasManageGuild(g.permissions));
  const guildIds = managed.map(g => g.id);

  let activeCountsByGuild = {};
  if (guildIds.length > 0) {
    const { data } = await supabase
      .from('giveaways')
      .select('guild_id')
      .in('guild_id', guildIds)
      .eq('ended', false);
    (data ?? []).forEach(r => {
      activeCountsByGuild[r.guild_id] = (activeCountsByGuild[r.guild_id] ?? 0) + 1;
    });
  }

  const client = req.discordClient;

  res.json(managed.map(g => {
    const hasBot = client ? client.guilds.cache.has(g.id) : false;
    const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&permissions=8&scope=bot%20applications.commands&guild_id=${g.id}&disable_guild_select=true`;
    return {
      id: g.id,
      name: g.name,
      iconUrl: g.icon
        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`
        : null,
      activeGiveaways: activeCountsByGuild[g.id] ?? 0,
      hasBot,
      inviteUrl,
    };
  }));
});

// ── Channels ─────────────────────────────────────────────────────────────────

router.get('/channels/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  let guilds;
  try {
    guilds = await getUserGuilds(req.user.accessToken);
  } catch {
    return res.status(502).json({ error: 'Failed to verify guild access' });
  }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const channels = await getGuildChannels(guildId);
    res.json(channels.map(c => ({ id: c.id, name: c.name })));
  } catch {
    res.status(502).json({ error: 'Failed to fetch channels. Is the bot in this server?' });
  }
});

// ── Giveaways ─────────────────────────────────────────────────────────────────

router.get('/giveaways', requireAuth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });

  let guilds;
  try {
    guilds = await getUserGuilds(req.user.accessToken);
  } catch {
    return res.status(502).json({ error: 'Failed to verify guild access' });
  }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: giveaways, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const messageIds = (giveaways ?? []).map(g => g.message_id);
  let entryCounts = {};

  // Check telemetry setting for the guild
  const settings = await getGuildSettings(guildId);
  const telemetryEnabled = settings ? settings.telemetry : true;

  if (telemetryEnabled && messageIds.length > 0) {
    const { data: entries } = await supabase
      .from('entries')
      .select('message_id')
      .in('message_id', messageIds);
    (entries ?? []).forEach(e => {
      entryCounts[e.message_id] = (entryCounts[e.message_id] ?? 0) + 1;
    });
  }

  res.json((giveaways ?? []).map(g => ({ ...g, entryCount: entryCounts[g.message_id] ?? 0 })));
});

router.post('/giveaways', requireAuth, async (req, res) => {
  const { guildId, channelId, prize, duration, winners, type } = req.body;
  if (!guildId || !channelId || !prize) {
    return res.status(400).json({ error: 'guildId, channelId, and prize are required' });
  }

  let guilds;
  try {
    guilds = await getUserGuilds(req.user.accessToken);
  } catch {
    return res.status(502).json({ error: 'Failed to verify guild access' });
  }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const isDrop = type === 'drop';
  const hostTag = req.user.globalName ?? req.user.name ?? 'Dashboard';
  let endsAt;

  if (isDrop) {
    endsAt = new Date(Date.now() + 86_400_000);
  } else {
    const ms = parseDuration(duration ?? '1h');
    if (!ms) return res.status(400).json({ error: 'Invalid duration. Use: 30m, 2h, 1d, 1w' });
    endsAt = new Date(Date.now() + ms);
  }

  const winnerCount = isDrop ? 1 : Math.max(1, parseInt(winners) || 1);

  try {
    const initial = isDrop
      ? buildDropPayload(null, { prize })
      : buildGiveawayPayload(null, { prize, winnerCount, endsAt, hostTag });

    const message = await postMessage(channelId, initial);
    const messageId = message.id;

    const withButton = isDrop
      ? buildDropPayload(messageId, { prize })
      : buildGiveawayPayload(messageId, { prize, winnerCount, endsAt, hostTag });

    await editMessage(channelId, messageId, withButton);

    const { data, error } = await supabase
      .from('giveaways')
      .insert({
        message_id: messageId,
        channel_id: channelId,
        guild_id: guildId,
        prize,
        winner_count: winnerCount,
        ends_at: endsAt.toISOString(),
        host_id: req.user.discordId ?? '0',
        host_tag: hostTag,
        ended: false,
        is_drop: isDrop,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ ...data, entryCount: 0 });
  } catch (err) {
    console.error('[POST /api/giveaways]', err);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/giveaways/:messageId', requireAuth, async (req, res) => {
  const { messageId } = req.params;
  const { data: giveaway, error } = await supabase
    .from('giveaways').select('*').eq('message_id', messageId).maybeSingle();
  if (error || !giveaway) return res.status(404).json({ error: 'Giveaway not found' });

  let guilds;
  try { guilds = await getUserGuilds(req.user.accessToken); }
  catch { return res.status(502).json({ error: 'Failed to verify guild access' }); }
  if (!guilds.find(g => g.id === giveaway.guild_id && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: entries, error: eErr } = await supabase
    .from('entries').select('user_id').eq('message_id', messageId);
  if (eErr) return res.status(500).json({ error: eErr.message });
  if (!entries?.length) return res.status(400).json({ error: 'No entries to reroll from' });

  const winners = pickWinners(entries, giveaway.winner_count);
  const winnerMentions = winners.map(w => `<@${w.user_id}>`);

  try {
    await postMessage(giveaway.channel_id, {
      content: `🎲 **Reroll!** New winner(s) for **${giveaway.prize}**: ${winnerMentions.join(', ')}! Congratulations!`,
    });
  } catch (err) {
    console.error('[PATCH reroll] Discord post failed:', err);
  }

  res.json({ winnerMentions, winnerIds: winners.map(w => w.user_id) });
});

router.delete('/giveaways/:messageId', requireAuth, async (req, res) => {
  const { messageId } = req.params;
  const { data: giveaway, error } = await supabase
    .from('giveaways').select('*').eq('message_id', messageId).maybeSingle();
  if (error || !giveaway) return res.status(404).json({ error: 'Giveaway not found' });
  if (giveaway.ended) return res.status(409).json({ error: 'Giveaway already ended' });

  let guilds;
  try { guilds = await getUserGuilds(req.user.accessToken); }
  catch { return res.status(502).json({ error: 'Failed to verify guild access' }); }
  if (!guilds.find(g => g.id === giveaway.guild_id && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: entries } = await supabase
    .from('entries').select('user_id').eq('message_id', messageId);

  const winners = pickWinners(entries ?? [], giveaway.winner_count);
  const winnerIds = winners.map(w => w.user_id);

  const { data: updated } = await supabase
    .from('giveaways')
    .update({ ended: true, winner_ids: winnerIds })
    .eq('message_id', messageId)
    .eq('ended', false)
    .select()
    .maybeSingle();

  if (!updated) return res.status(409).json({ error: 'Giveaway already ended' });
  const winnerMentions = winners.map(w => `<@${w.user_id}>`);

  try {
    await editMessage(giveaway.channel_id, messageId, buildEndedEmbedPayload(giveaway, winnerMentions));
    await postMessage(giveaway.channel_id, {
      content: winners.length
        ? `🎉 Congratulations ${winnerMentions.join(', ')}! You won **${giveaway.prize}**!`
        : `No entries for **${giveaway.prize}**. Giveaway ended with no winner.`,
    });
  } catch (err) {
    console.error('[DELETE giveaway] Discord update failed:', err.message);
  }

  res.json({ success: true, winnerMentions, winnerIds: winners.map(w => w.user_id) });
});

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_FILE = join(process.cwd(), 'src', 'api', 'settings.json');

function getLocalSettings(guildId) {
  try {
    if (!existsSync(SETTINGS_FILE)) {
      return { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
    }
    const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    return data[guildId] || { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
  } catch {
    return { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true };
  }
}

function saveLocalSettings(guildId, settings) {
  try {
    let data = {};
    if (existsSync(SETTINGS_FILE)) {
      data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    }
    data[guildId] = settings;
    writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save settings locally:', err);
    return false;
  }
}

router.get('/settings/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  
  let guilds;
  try {
    guilds = await getUserGuilds(req.user.accessToken);
  } catch {
    return res.status(502).json({ error: 'Failed to verify guild access' });
  }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (!error && data) {
      return res.json({
        managerRole: data.manager_role,
        logsChannel: data.logs_channel,
        embedColor: data.embed_color,
        telemetry: data.telemetry,
      });
    }
  } catch (err) {
    console.log(`[Supabase settings fetch failed, using local fallback]: ${err.message}`);
  }

  res.json(getLocalSettings(guildId));
});

router.post('/settings/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  const { managerRole, logsChannel, embedColor, telemetry } = req.body;

  let guilds;
  try {
    guilds = await getUserGuilds(req.user.accessToken);
  } catch {
    return res.status(502).json({ error: 'Failed to verify guild access' });
  }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  let savedInDb = false;
  try {
    const { error } = await supabase
      .from('settings')
      .upsert({
        guild_id: guildId,
        manager_role: managerRole,
        logs_channel: logsChannel,
        embed_color: embedColor,
        telemetry,
      });
    if (!error) savedInDb = true;
  } catch (err) {
    console.log(`[Supabase settings save failed, using local fallback]: ${err.message}`);
  }

  saveLocalSettings(guildId, { managerRole, logsChannel, embedColor, telemetry });
  res.json({ ok: true, savedInDb });
});

export default router;
