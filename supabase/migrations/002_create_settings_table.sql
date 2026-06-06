-- Migration 002: create settings table for server configurations
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)

CREATE TABLE IF NOT EXISTS settings (
  guild_id      TEXT PRIMARY KEY,
  manager_role  TEXT NOT NULL DEFAULT '@Giveaway Manager',
  logs_channel  TEXT NOT NULL DEFAULT '#giveaways',
  embed_color   TEXT NOT NULL DEFAULT '#8827e5',
  telemetry     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);
