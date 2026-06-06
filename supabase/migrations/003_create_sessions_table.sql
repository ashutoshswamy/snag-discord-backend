-- Migration 003: OAuth sessions table (stores Discord access tokens server-side)
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT        PRIMARY KEY,
  discord_id  TEXT        NOT NULL,
  access_token TEXT       NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Only the service role can access sessions — no anon/user access
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
