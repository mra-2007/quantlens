-- QuantLens schema (PostgreSQL 13+). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  password_hash TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_items (
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS strategies (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  symbol     TEXT,
  config     JSONB NOT NULL,
  last_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS strategies_user_idx ON strategies(user_id);

CREATE TABLE IF NOT EXISTS price_alerts (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol       TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  target       NUMERIC(18, 6) NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  triggered_at TIMESTAMPTZ,
  triggered_price NUMERIC(18, 6),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS price_alerts_active_idx ON price_alerts(active) WHERE active;

CREATE TABLE IF NOT EXISTS holdings (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT NOT NULL,
  quantity   NUMERIC(18, 6) NOT NULL CHECK (quantity > 0),
  avg_price  NUMERIC(18, 6) NOT NULL CHECK (avg_price >= 0),
  source     TEXT NOT NULL DEFAULT 'manual',
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);
