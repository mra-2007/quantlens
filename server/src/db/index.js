// Data access layer. Uses PostgreSQL when DATABASE_URL is set; otherwise an
// in-memory store with the same interface (data resets on restart; for local dev).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function pgRepo() {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: /sslmode=require/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined });
  const q = async (text, params) => (await pool.query(text, params)).rows;
  const one = async (text, params) => (await q(text, params))[0] ?? null;
  const user = (u) => u && { id: String(u.id), email: u.email, name: u.name, plan: u.plan, passwordHash: u.password_hash, createdAt: u.created_at };
  const strat = (s) => s && { id: String(s.id), name: s.name, symbol: s.symbol, config: s.config, lastResult: s.last_result, createdAt: s.created_at };
  const holding = (h) => h && { id: String(h.id), symbol: h.symbol, quantity: Number(h.quantity), avgPrice: Number(h.avg_price), source: h.source, addedAt: h.added_at };
  const alert = (a) => a && { id: String(a.id), userId: String(a.user_id), symbol: a.symbol, direction: a.direction, target: Number(a.target), active: a.active, triggeredAt: a.triggered_at, triggeredPrice: a.triggered_price == null ? null : Number(a.triggered_price), createdAt: a.created_at, email: a.email };

  return {
    kind: "postgres",
    async migrate() {
      await pool.query(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));
    },
    users: {
      create: async ({ email, name, passwordHash }) => user(await one("INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *", [email, name, passwordHash])),
      byEmail: async (email) => user(await one("SELECT * FROM users WHERE email = $1", [email])),
      byId: async (id) => user(await one("SELECT * FROM users WHERE id = $1", [id])),
      setPlan: async (id, plan) => user(await one("UPDATE users SET plan = $2 WHERE id = $1 RETURNING *", [id, plan])),
    },
    watchlist: {
      list: async (userId) => (await q("SELECT symbol, added_at FROM watchlist_items WHERE user_id = $1 ORDER BY added_at", [userId])).map((r) => ({ symbol: r.symbol, addedAt: r.added_at })),
      add: async (userId, symbol) => q("INSERT INTO watchlist_items (user_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, symbol]),
      remove: async (userId, symbol) => q("DELETE FROM watchlist_items WHERE user_id = $1 AND symbol = $2", [userId, symbol]),
      count: async (userId) => Number((await one("SELECT count(*) FROM watchlist_items WHERE user_id = $1", [userId])).count),
    },
    strategies: {
      list: async (userId) => (await q("SELECT * FROM strategies WHERE user_id = $1 ORDER BY created_at DESC", [userId])).map(strat),
      create: async (userId, { name, symbol, config: cfg, lastResult }) => strat(await one("INSERT INTO strategies (user_id, name, symbol, config, last_result) VALUES ($1, $2, $3, $4, $5) RETURNING *", [userId, name, symbol, cfg, lastResult ?? null])),
      remove: async (userId, id) => q("DELETE FROM strategies WHERE user_id = $1 AND id = $2", [userId, id]),
    },
    alerts: {
      list: async (userId) => (await q("SELECT * FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC", [userId])).map(alert),
      create: async (userId, { symbol, direction, target }) => alert(await one("INSERT INTO price_alerts (user_id, symbol, direction, target) VALUES ($1, $2, $3, $4) RETURNING *", [userId, symbol, direction, target])),
      remove: async (userId, id) => q("DELETE FROM price_alerts WHERE user_id = $1 AND id = $2", [userId, id]),
      active: async () => (await q("SELECT a.*, u.email FROM price_alerts a JOIN users u ON u.id = a.user_id WHERE a.active AND u.plan = 'pro'")).map(alert),
      trigger: async (id, price) => q("UPDATE price_alerts SET active = false, triggered_at = now(), triggered_price = $2 WHERE id = $1", [id, price]),
    },
    holdings: {
      list: async (userId) => (await q("SELECT * FROM holdings WHERE user_id = $1 ORDER BY added_at", [userId])).map(holding),
      // Adding a stock you already hold merges the lots: quantities add, the average price is weighted.
      add: async (userId, { symbol, quantity, avgPrice, source = "manual" }) => holding(await one(
        `INSERT INTO holdings (user_id, symbol, quantity, avg_price, source) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, symbol) DO UPDATE SET
           avg_price = (holdings.quantity * holdings.avg_price + EXCLUDED.quantity * EXCLUDED.avg_price) / (holdings.quantity + EXCLUDED.quantity),
           quantity = holdings.quantity + EXCLUDED.quantity
         RETURNING *`, [userId, symbol, quantity, avgPrice, source])),
      update: async (userId, id, { quantity, avgPrice }) => holding(await one("UPDATE holdings SET quantity = $3, avg_price = $4 WHERE user_id = $1 AND id = $2 RETURNING *", [userId, id, quantity, avgPrice])),
      remove: async (userId, id) => q("DELETE FROM holdings WHERE user_id = $1 AND id = $2", [userId, id]),
      clear: async (userId) => q("DELETE FROM holdings WHERE user_id = $1", [userId]),
    },
    close: () => pool.end(),
  };
}

function memoryRepo() {
  let seq = 1;
  const users = new Map();
  const watch = new Map();
  const strategies = [];
  const alerts = [];
  const holdingsArr = [];
  const now = () => new Date().toISOString();
  return {
    kind: "memory",
    async migrate() {},
    users: {
      create: async ({ email, name, passwordHash }) => {
        if ([...users.values()].some((u) => u.email === email)) {
          const e = new Error("duplicate");
          e.code = "23505";
          throw e;
        }
        const u = { id: String(seq++), email, name, passwordHash, plan: "free", createdAt: now() };
        users.set(u.id, u);
        return { ...u };
      },
      byEmail: async (email) => [...users.values()].find((u) => u.email === email) ?? null,
      byId: async (id) => users.get(String(id)) ?? null,
      setPlan: async (id, plan) => {
        const u = users.get(String(id));
        if (u) u.plan = plan;
        return u;
      },
    },
    watchlist: {
      list: async (userId) => [...(watch.get(userId) ?? new Map()).entries()].map(([symbol, addedAt]) => ({ symbol, addedAt })),
      add: async (userId, symbol) => {
        if (!watch.has(userId)) watch.set(userId, new Map());
        if (!watch.get(userId).has(symbol)) watch.get(userId).set(symbol, now());
      },
      remove: async (userId, symbol) => watch.get(userId)?.delete(symbol),
      count: async (userId) => watch.get(userId)?.size ?? 0,
    },
    strategies: {
      list: async (userId) => strategies.filter((s) => s.userId === userId).reverse(),
      create: async (userId, data) => {
        const s = { id: String(seq++), userId, ...data, createdAt: now() };
        strategies.push(s);
        return s;
      },
      remove: async (userId, id) => {
        const i = strategies.findIndex((s) => s.userId === userId && s.id === String(id));
        if (i >= 0) strategies.splice(i, 1);
      },
    },
    alerts: {
      list: async (userId) => alerts.filter((a) => a.userId === userId).reverse(),
      create: async (userId, data) => {
        const a = { id: String(seq++), userId, ...data, active: true, triggeredAt: null, triggeredPrice: null, createdAt: now() };
        alerts.push(a);
        return a;
      },
      remove: async (userId, id) => {
        const i = alerts.findIndex((a) => a.userId === userId && a.id === String(id));
        if (i >= 0) alerts.splice(i, 1);
      },
      active: async () => alerts.filter((a) => a.active && users.get(a.userId)?.plan === "pro").map((a) => ({ ...a, email: users.get(a.userId)?.email })),
      trigger: async (id, price) => {
        const a = alerts.find((x) => x.id === String(id));
        if (a) Object.assign(a, { active: false, triggeredAt: now(), triggeredPrice: price });
      },
    },
    holdings: {
      list: async (userId) => holdingsArr.filter((h) => h.userId === userId).map(({ userId: _u, ...h }) => ({ ...h })),
      add: async (userId, { symbol, quantity, avgPrice, source = "manual" }) => {
        const ex = holdingsArr.find((h) => h.userId === userId && h.symbol === symbol);
        if (ex) {
          ex.avgPrice = (ex.quantity * ex.avgPrice + quantity * avgPrice) / (ex.quantity + quantity);
          ex.quantity += quantity;
          return { ...ex };
        }
        const h = { id: String(seq++), userId, symbol, quantity, avgPrice, source, addedAt: now() };
        holdingsArr.push(h);
        return { ...h };
      },
      update: async (userId, id, { quantity, avgPrice }) => {
        const h = holdingsArr.find((x) => x.userId === userId && x.id === String(id));
        if (!h) return null;
        Object.assign(h, { quantity, avgPrice });
        return { ...h };
      },
      remove: async (userId, id) => {
        const i = holdingsArr.findIndex((h) => h.userId === userId && h.id === String(id));
        if (i >= 0) holdingsArr.splice(i, 1);
      },
      clear: async (userId) => {
        for (let i = holdingsArr.length - 1; i >= 0; i--) if (holdingsArr[i].userId === userId) holdingsArr.splice(i, 1);
      },
    },
    close: async () => {},
  };
}

export const db = config.databaseUrl ? pgRepo() : memoryRepo();
