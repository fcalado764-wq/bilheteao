-- Fix admin_sessions table
-- Execute este SQL no Editor SQL do Supabase

DROP TABLE IF EXISTS admin_sessions CASCADE;

CREATE TABLE admin_sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'admin',
  permissions JSONB DEFAULT '{"manage_events": true, "manage_users": true, "manage_admins": true}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes'
);

-- Enable RLS
ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY;

-- Create policy for read
CREATE POLICY "Enable read for admin sessions" ON admin_sessions
  FOR SELECT USING (true);

-- Create policy for insert
CREATE POLICY "Enable insert for admin sessions" ON admin_sessions
  FOR INSERT WITH CHECK (true);

-- Create policy for update
CREATE POLICY "Enable update for admin sessions" ON admin_sessions
  FOR UPDATE USING (true);

-- Create policy for delete
CREATE POLICY "Enable delete for admin sessions" ON admin_sessions
  FOR DELETE USING (true);
