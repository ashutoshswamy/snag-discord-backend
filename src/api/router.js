import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import supabase, { supabaseAdmin } from '../supabaseClient.js';
import {
  getUserGuilds, hasManageGuild, getGuildChannels, getGuildRoles,
  postMessage, editMessage, parseDuration,
  buildGiveawayPayload, buildDropPayload,
  buildEndedEmbedPayload, pickWinners,
} from '../lib/discordRest.js';
import { getGuildSettings } from '../utils/settingsHelper.js';

const router = Router();
const DISCORD_API = 'https://discord.com/api/v10';
const COOKIE_NAME = 'snag_session';
const OAUTH_STATE_COOKIE = 'snag_oauth_state';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// H-1: fatal if JWT_SECRET missing — no insecure fallback
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in environment.');

// H-4: sameSite lax prevents cross-site CSRF while still allowing dashboard navigation
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// ── Validation helpers ────────────────────────────────────────────────────────

const isSnowflake = s => /^\d{17,20}$/.test(String(s ?? ''));
const isHexColor = s => !s || /^#[0-9A-Fa-f]{6}$/.test(s);

// ── Rate limiters (H-3) ───────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts. Please try again later.' },
});

const destructiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

router.use(globalLimiter);

// ── Auth helpers ──────────────────────────────────────────────────────────────

function verifyToken(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

// H-2: requireAuth fetches the access_token from the sessions table (not from JWT)
async function requireAuth(req, res, next) {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: session } = await supabaseAdmin
      .from('sessions')
      .select('access_token')
      .eq('id', payload.sessionId)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });

    req.user = { ...payload, accessToken: session.access_token };
    next();
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Status ──────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  const client = req.discordClient;
  const online = client?.isReady() ?? false;

  const guildCount  = client?.guilds.cache.size ?? 0;
  const memberCount = client?.guilds.cache.reduce((acc, g) => acc + (g.memberCount ?? 0), 0) ?? 0;
  const latencyMs   = online ? client.ws.ping : -1;
  const uptimeMs    = online ? (client.uptime ?? 0) : 0;
  const commandCount = client?.commands?.size ?? 0;

  let giveawayCount = 0;
  try {
    const { count } = await supabase.from('giveaways').select('*', { count: 'exact', head: true });
    giveawayCount = count ?? 0;
  } catch {}

  const bot = online ? {
    username: client.user.username,
    avatar: client.user.displayAvatarURL({ size: 128 }),
  } : null;

  res.json({
    online,
    bot,
    stats: { guildCount, memberCount, latencyMs, uptimeMs, commandCount, giveawayCount },
  });
});

// ── Auth ────────────────────────────────────────────────────────────────────

// M-2: generate state token to prevent OAuth CSRF
router.get('/auth/discord', authLimiter, (req, res) => {
  const state = randomBytes(16).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  res.redirect(`${DISCORD_API}/oauth2/authorize?${params}`);
});

router.get('/auth/callback', authLimiter, async (req, res) => {
  const { code, state } = req.query;

  // M-2: verify state to prevent OAuth CSRF
  const expectedState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: '/' });

  if (!code) return res.redirect(`${FRONTEND_URL}/?error=no_code`);
  if (!state || !expectedState || state !== expectedState) {
    return res.redirect(`${FRONTEND_URL}/?error=invalid_state`);
  }

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
      console.error('[OAuth callback] Token exchange failed:', tokenRes.status);
      return res.redirect(`${FRONTEND_URL}/?error=token_exchange`);
    }

    const { access_token } = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const user = await userRes.json();

    // H-2: store access_token in sessions table, not in JWT
    const sessionId = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await supabaseAdmin.from('sessions').insert({
      id: sessionId,
      discord_id: user.id,
      access_token,
      expires_at: expiresAt.toISOString(),
    });

    const payload = {
      sessionId,
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
    console.error('[OAuth callback] Unexpected error:', err.message);
    res.redirect(`${FRONTEND_URL}/?error=server`);
  }
});

router.get('/auth/me', (req, res) => {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { sessionId, ...safe } = user;
  res.json(safe);
});

router.post('/auth/logout', async (req, res) => {
  const payload = verifyToken(req);
  if (payload?.sessionId) {
    await supabaseAdmin.from('sessions').delete().eq('id', payload.sessionId).catch(() => {});
  }
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
    // M-3: no internal detail in response
    return res.status(502).json({ error: 'Failed to fetch Discord guilds' });
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
  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });

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

// ── Roles ─────────────────────────────────────────────────────────────────────

router.get('/roles/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });

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
    const roles = await getGuildRoles(guildId);
    res.json(roles.map(r => ({ id: r.id, name: r.name, color: r.color })));
  } catch {
    res.status(502).json({ error: 'Failed to fetch roles. Is the bot in this server?' });
  }
});

// ── Giveaways ─────────────────────────────────────────────────────────────────

router.get('/giveaways', requireAuth, async (req, res) => {
  const { guildId } = req.query;
  if (!guildId || !isSnowflake(guildId)) return res.status(400).json({ error: 'Valid guildId required' });

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

  if (error) {
    console.error('[GET /api/giveaways]', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const messageIds = (giveaways ?? []).map(g => g.message_id);
  let entryCounts = {};

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
  // H-5: validate all inputs
  const { guildId, channelId, prize: rawPrize, duration, winners, type } = req.body;

  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });
  if (!isSnowflake(channelId)) return res.status(400).json({ error: 'Invalid channelId' });

  const prize = String(rawPrize ?? '').trim();
  if (!prize || prize.length > 100) {
    return res.status(400).json({ error: 'prize is required and must be 1–100 characters' });
  }

  const isDrop = type === 'drop';
  const hostTag = req.user.globalName ?? req.user.name ?? 'Dashboard';
  let endsAt;

  if (isDrop) {
    endsAt = new Date(Date.now() + 86_400_000);
  } else {
    const ms = parseDuration(String(duration ?? ''));
    if (!ms) return res.status(400).json({ error: 'Invalid duration. Use: 30m, 2h, 1d, 1w' });
    endsAt = new Date(Date.now() + ms);
  }

  const winnerCount = isDrop ? 1 : Math.min(20, Math.max(1, parseInt(winners) || 1));

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
    console.error('[POST /api/giveaways]', err.message);
    // M-3: no internal error detail
    res.status(500).json({ error: 'Failed to create giveaway. Please try again.' });
  }
});

// C-3: require guildId param so DB is always queried with guild scope before auth check
router.patch('/giveaways/:messageId', requireAuth, async (req, res) => {
  const { messageId } = req.params;
  const { guildId } = req.query;

  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Valid guildId query parameter required' });

  let guilds;
  try { guilds = await getUserGuilds(req.user.accessToken); }
  catch { return res.status(502).json({ error: 'Failed to verify guild access' }); }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // Fetch AFTER auth check, scoped to the verified guild
  const { data: giveaway, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('message_id', messageId)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error || !giveaway) return res.status(404).json({ error: 'Giveaway not found' });

  const { data: entries, error: eErr } = await supabase
    .from('entries').select('user_id').eq('message_id', messageId);
  if (eErr) return res.status(500).json({ error: 'Internal server error' });
  if (!entries?.length) return res.status(400).json({ error: 'No entries to reroll from' });

  const winners = pickWinners(entries, giveaway.winner_count);
  const winnerMentions = winners.map(w => `<@${w.user_id}>`);

  try {
    await postMessage(giveaway.channel_id, {
      content: `🎲 **Reroll!** New winner(s) for **${giveaway.prize}**: ${winnerMentions.join(', ')}! Congratulations!`,
    });
  } catch (err) {
    console.error('[PATCH reroll] Discord post failed:', err.message);
  }

  res.json({ winnerMentions, winnerIds: winners.map(w => w.user_id) });
});

// C-3 same fix for delete endpoint
router.delete('/giveaways/:messageId', requireAuth, async (req, res) => {
  const { messageId } = req.params;
  const { guildId } = req.query;

  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Valid guildId query parameter required' });

  let guilds;
  try { guilds = await getUserGuilds(req.user.accessToken); }
  catch { return res.status(502).json({ error: 'Failed to verify guild access' }); }
  if (!guilds.find(g => g.id === guildId && hasManageGuild(g.permissions))) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { data: giveaway, error } = await supabase
    .from('giveaways')
    .select('*')
    .eq('message_id', messageId)
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error || !giveaway) return res.status(404).json({ error: 'Giveaway not found' });
  if (giveaway.ended) return res.status(409).json({ error: 'Giveaway already ended' });

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

// M-4: async file write to avoid blocking the event loop
async function saveLocalSettings(guildId, settings) {
  try {
    let data = {};
    if (existsSync(SETTINGS_FILE)) {
      data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
    }
    data[guildId] = settings;
    await writeFile(SETTINGS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Failed to save settings locally:', err.message);
    return false;
  }
}

router.get('/settings/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });

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
    console.error('[GET /api/settings] Supabase failed, falling back to local:', err.message);
  }

  res.json(getLocalSettings(guildId));
});

router.post('/settings/:guildId', requireAuth, async (req, res) => {
  const { guildId } = req.params;
  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });

  // H-5: validate settings inputs
  const { managerRole, logsChannel, embedColor, telemetry } = req.body;

  if (managerRole !== undefined && typeof managerRole !== 'string') {
    return res.status(400).json({ error: 'managerRole must be a string' });
  }
  if (managerRole && managerRole.length > 100) {
    return res.status(400).json({ error: 'managerRole must be 100 characters or fewer' });
  }
  if (logsChannel !== undefined && typeof logsChannel !== 'string') {
    return res.status(400).json({ error: 'logsChannel must be a string' });
  }
  if (logsChannel && logsChannel.length > 100) {
    return res.status(400).json({ error: 'logsChannel must be 100 characters or fewer' });
  }
  if (embedColor && !isHexColor(embedColor)) {
    return res.status(400).json({ error: 'embedColor must be a valid hex color (e.g. #FF5733)' });
  }
  if (telemetry !== undefined && typeof telemetry !== 'boolean') {
    return res.status(400).json({ error: 'telemetry must be a boolean' });
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
    console.error('[POST /api/settings] Supabase failed, falling back to local:', err.message);
  }

  await saveLocalSettings(guildId, { managerRole, logsChannel, embedColor, telemetry });
  res.json({ ok: true, savedInDb });
});

// ── Reset ─────────────────────────────────────────────────────────────────────

router.delete('/reset/:guildId', requireAuth, destructiveLimiter, async (req, res) => {
  const { guildId } = req.params;
  if (!isSnowflake(guildId)) return res.status(400).json({ error: 'Invalid guildId' });

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
    const { data: giveaways } = await supabase
      .from('giveaways')
      .select('message_id')
      .eq('guild_id', guildId);

    const messageIds = (giveaways ?? []).map(g => g.message_id);

    if (messageIds.length > 0) {
      await supabase.from('entries').delete().in('message_id', messageIds);
    }

    await supabase.from('giveaways').delete().eq('guild_id', guildId);
    await supabase.from('settings').delete().eq('guild_id', guildId);

    await saveLocalSettings(guildId, { managerRole: '@Giveaway Manager', logsChannel: '#giveaways', embedColor: '#8827e5', telemetry: true });

    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /reset/:guildId]', err.message);
    // M-3: no internal error detail
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
