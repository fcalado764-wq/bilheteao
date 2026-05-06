-- ============================================================
-- schema.sql — Esquema da base de dados BilheteAO
-- Execute este SQL no Editor SQL do Supabase
-- ============================================================

-- ── Extensão para UUIDs ────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Tabela: utilizadores ───────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabela: eventos ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  date              DATE NOT NULL,
  time              TEXT NOT NULL,
  location          TEXT NOT NULL,
  price             NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  category          TEXT NOT NULL DEFAULT 'Geral',
  total_seats       INTEGER NOT NULL CHECK (total_seats > 0),
  sold_seats        INTEGER NOT NULL DEFAULT 0,
  emoji             TEXT DEFAULT '🎟️',
  description       TEXT,
  cover             TEXT,
  poster            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_by_name TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Tabela: sessões de utilizador ──────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name   TEXT NOT NULL,
  user_email  TEXT NOT NULL,
  user_role   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

-- ── Tabela: sessões de administrador ──────────────────────
CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 day'
);

-- ── Tabela: credenciais de administrador ──────────────────
CREATE TABLE IF NOT EXISTS admin_credentials (
  id        INTEGER PRIMARY KEY DEFAULT 1,
  username  TEXT NOT NULL DEFAULT 'admin',
  password  TEXT NOT NULL DEFAULT 'admin123',
  CONSTRAINT single_row CHECK (id = 1)
);

-- Inserir credenciais padrão
INSERT INTO admin_credentials (id, username, password)
VALUES (1, 'admin', 'admin123')
ON CONFLICT (id) DO NOTHING;

-- ── Tabela: vendas / bilhetes ──────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code     TEXT UNIQUE NOT NULL,
  event_id        UUID REFERENCES events(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  customer_name   TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  quantity        INTEGER NOT NULL DEFAULT 1,
  total_price     NUMERIC(10,2) NOT NULL,
  pdf_file        TEXT,
  validated       BOOLEAN DEFAULT FALSE,
  validated_at    TIMESTAMPTZ,
  validated_by    TEXT,
  purchased_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── Dados de exemplo ───────────────────────────────────────
INSERT INTO events (name, date, time, location, price, category, total_seats, sold_seats, emoji, description, status, submitted_by_name)
VALUES
  ('Festival de Jazz de Luanda',     '2025-08-15', '20:00', 'Jardim da Samba, Luanda',              2500, 'Música',     200,  47,  '🎷', 'Uma noite inesquecível com os melhores artistas de jazz do continente africano.', 'approved', 'Sistema'),
  ('Conferência Tech Angola 2025',   '2025-09-10', '09:00', 'Centro de Convenções de Talatona',     5000, 'Tecnologia', 500,  312, '💻', 'O maior evento de tecnologia de Angola, reunindo especialistas nacionais e internacionais.', 'approved', 'Sistema'),
  ('Peça de Teatro: A Cidade do Sol','2025-07-28', '19:30', 'Teatro Nacional de Angola',             1500, 'Teatro',     150,  89,  '🎭', 'Uma produção original que explora a identidade e modernidade de Angola.', 'approved', 'Sistema'),
  ('Maratona de Luanda 2025',        '2025-10-05', '06:00', 'Marginal de Luanda',                   800,  'Desporto',   1000, 234, '🏃', 'Corra pelas ruas da capital angolana na maior maratona do país.', 'approved', 'Sistema')
ON CONFLICT DO NOTHING;

-- ── Índices para melhor performance ───────────────────────
CREATE INDEX IF NOT EXISTS idx_events_status    ON events(status);
CREATE INDEX IF NOT EXISTS idx_sales_ticket     ON sales(ticket_code);
CREATE INDEX IF NOT EXISTS idx_sales_user       ON sales(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ── Limpeza automática de sessões expiradas ───────────────
-- (opcional — execute manualmente ou crie um cron job no Supabase)
-- DELETE FROM sessions       WHERE expires_at < NOW();
-- DELETE FROM admin_sessions WHERE expires_at < NOW();
