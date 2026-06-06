-- Migration 001: add winner_ids column to giveaways
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)

ALTER TABLE giveaways
  ADD COLUMN IF NOT EXISTS winner_ids TEXT[] NOT NULL DEFAULT '{}';
