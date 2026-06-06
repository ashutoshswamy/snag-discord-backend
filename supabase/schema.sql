-- Run these in Supabase SQL Editor (Dashboard > SQL Editor)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS giveaways (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id  TEXT        UNIQUE NOT NULL,
  channel_id  TEXT        NOT NULL,
  guild_id    TEXT        NOT NULL,
  prize       TEXT        NOT NULL,
  winner_count INTEGER    NOT NULL DEFAULT 1,
  ends_at     TIMESTAMPTZ NOT NULL,
  ended       BOOLEAN     NOT NULL DEFAULT false,
  is_drop     BOOLEAN     NOT NULL DEFAULT false,
  host_id     TEXT        NOT NULL,
  host_tag    TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entries (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id  TEXT        NOT NULL REFERENCES giveaways(message_id) ON DELETE CASCADE,
  user_id     TEXT        NOT NULL,
  guild_id    TEXT        NOT NULL,
  entered_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_giveaways_guild   ON giveaways(guild_id);
CREATE INDEX IF NOT EXISTS idx_giveaways_active  ON giveaways(ended, ends_at) WHERE ended = false;
CREATE INDEX IF NOT EXISTS idx_entries_message   ON entries(message_id);
