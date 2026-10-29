import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db/index.js";
import { config } from "../config.js";
import { signToken, publicUser, requireAuth, requirePro } from "../lib/auth.js";
import { getHistory, search, normaliseSymbol, RANGES } from "../lib/market.js";
import { analyzeStock } from "../quant/analyze.js";
import { correlationMatrix } from "../quant/portfolio.js";
import { simpleReturns, alignCloses, betaVsIndex, volatility, sharpeRatio, maxDrawdown } from "../quant/risk.js";
import { PRESETS, validateStrategy, INDICATORS } from "../quant/backtest.js";
import { enqueue, getJob } from "../jobs/queue.js";
import { resolveSymbol } from "../lib/resolve.js";

export const api = Router();

const FREE_WATCHLIST_LIMIT = 5;

/** Wraps async handlers and validates bodies with zod. */
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) {
    const e = new Error(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    e.status = 400;
    throw e;
  }
  return r.data;
};
const symbolSchema = z.string().min(1).max(20).transform((s) => normaliseSymbol(s));
const rangeSchema = z.enum(Object.keys(RANGES));

// ---------- meta ----------
api.get("/health", (_req, res) => res.json({ ok: true, provider: config.dataProvider, db: db.kind, cache: config.redisUrl ? "redis" : "memory", queue: config.redisUrl ? "bullmq" : "in-process" }));

// ---------- auth ----------
const credentials = z.object({ email: z.string().email().max(200).transform((s) => s.toLowerCase().trim()), password: z.string().min(8, "Password must be at least 8 characters").max(200), name: z.string().max(80).optional() });

api.post("/auth/register", h(async (req, res) => {
  const { email, password, name } = parse(credentials, req.body);
  try {
    const user = await db.users.create({ email, name, passwordHash: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "An account with this email already exists" });
    throw e;
  }
}));

api.post("/auth/login", h(async (req, res) => {
  const { email, password } = parse(credentials.pick({ email: true, password: true }).extend({ password: z.string().min(1).max(200) }), req.body);
  const user = await db.users.byEmail(email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Email or password is incorrect" });
  res.json({ token: signToken(user), user: publicUser(user) });
}));

api.get("/auth/me", requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

// ---------- billing (Razorpay) ----------
const razorpayOn = () => Boolean(config.razorpay.keyId && config.razorpay.keySecret);

api.get("/billing/config", (_req, res) => {
  res.json({ provider: razorpayOn() ? "razorpay" : "demo", keyId: config.razorpay.keyId || null, amount: config.proPricePaise, currency: "INR", testMode: config.razorpay.keyId.startsWith("rzp_test_") });
});

/** Step 1: create a Razorpay order for one month of Pro. */
api.post("/billing/order", requireAuth, h(async (req, res) => {
  if (!razorpayOn()) return res.status(400).json({ error: "Payments are not configured on this server" });
  const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64");
  let r;
  try {
    r = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: config.proPricePaise, currency: "INR", receipt: `pro_${req.user.id}_${Date.now()}`, notes: { userId: req.user.id, plan: "pro" } }),
    });
  } catch {
    return res.status(502).json({ error: "Couldn't reach Razorpay. Check the server's internet connection and try again." });
  }
  const order = await r.json();
  if (!r.ok) return res.status(502).json({ error: order?.error?.description ?? "Could not create the payment order" });
  res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: config.razorpay.keyId });
}));

/** Step 2: verify the checkout signature HMAC_SHA256(order_id|payment_id, secret), then grant Pro. */
api.post("/billing/verify", requireAuth, h(async (req, res) => {
  if (!razorpayOn()) return res.status(400).json({ error: "Payments are not configured on this server" });
  const body = parse(z.object({ razorpay_order_id: z.string().min(1), razorpay_payment_id: z.string().min(1), razorpay_signature: z.string().min(1) }), req.body);
  const expected = crypto.createHmac("sha256", config.razorpay.keySecret).update(`${body.razorpay_order_id}|${body.razorpay_payment_id}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(body.razorpay_signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(400).json({ error: "Payment could not be verified, so Pro was not activated. If money was deducted, contact support with your payment ID." });
  const user = await db.users.setPlan(req.user.id, "pro");
  console.log(`[billing] ${user.email} upgraded to Pro (payment ${body.razorpay_payment_id})`);
  res.json({ token: signToken(user), user: publicUser(user), paymentId: body.razorpay_payment_id });
}));

// Plan switch without payment: always allowed to go back to Free; going to Pro only
// when payments are not configured (demo mode for local development).
api.post("/auth/upgrade", requireAuth, h(async (req, res) => {
  const plan = req.body?.plan === "free" ? "free" : "pro";
  if (plan === "pro" && (razorpayOn() || !config.allowSelfUpgrade)) return res.status(402).json({ error: "Upgrade to Pro through checkout", upgrade: true });
  const user = await db.users.setPlan(req.user.id, plan);
  res.json({ token: signToken(user), user: publicUser(user) });
}));

// ---------- market data + analysis (free) ----------
api.get("/search", h(async (req, res) => res.json({ results: await search(req.query.q) })));

api.get("/stocks/:symbol/history", h(async (req, res) => {
  const range = parse(rangeSchema.default("1y"), req.query.range);
  const data = await getHistory(req.params.symbol, range);
  res.json(data);
}));

api.get("/stocks/:symbol/analysis", h(async (req, res) => {
  const range = parse(rangeSchema.default("1y"), req.query.range);
  const symbol = normaliseSymbol(req.params.symbol);
  const index = symbol.endsWith(".NS") || symbol.endsWith(".BO") ? "^NSEI" : config.defaultIndex;
  const [hist, idx] = await Promise.all([getHistory(symbol, range), symbol === index ? null : getHistory(index, range).catch(() => null)]);
  const analysis = analyzeStock(hist.candles, { indexCandles: idx?.candles, riskFree: config.riskFreeRate, plan: req.user?.plan ?? "anonymous" });
  res.json({ symbol, name: hist.name, currency: hist.currency, exchange: hist.exchange, simulated: !!hist.simulated, cached: hist.cached, index, candles: hist.candles, ...analysis });
}));

/** Compare 2–5 stocks: correlation heatmap, beta vs index, normalised performance and risk table. */
api.get("/compare", h(async (req, res) => {
  const symbols = parse(z.array(symbolSchema).min(2).max(5), String(req.query.symbols ?? "").split(",").filter(Boolean));
  const range = parse(rangeSchema.default("1y"), req.query.range);
  const index = symbols.every((s) => s.endsWith(".NS")) ? "^NSEI" : config.defaultIndex;
  const [histories, idx] = await Promise.all([Promise.all(symbols.map((s) => getHistory(s, range))), getHistory(index, range).catch(() => null)]);
  const map = Object.fromEntries(histories.map((x) => [x.symbol, x.candles]));
  if (idx) map[index] = idx.candles;
  const { dates, closes } = alignCloses(map);
  const returns = Object.fromEntries(symbols.map((s) => [s, simpleReturns(closes[s])]));
  const indexReturns = idx ? simpleReturns(closes[index]) : null;
  const step = Math.max(1, Math.floor(dates.length / 260));
  res.json({
    symbols,
    index,
    observations: dates.length,
    simulated: histories.some((x) => x.simulated),
    correlation: correlationMatrix(returns),
    performance: dates.filter((_, i) => i % step === 0 || i === dates.length - 1).map((t) => {
      const i = dates.indexOf(t);
      return { time: t, ...Object.fromEntries(symbols.map((s) => [s, closes[s][i] / closes[s][0] - 1])) };
    }),
    metrics: symbols.map((s) => ({
      symbol: s,
      name: histories.find((x) => x.symbol === s)?.name,
      totalReturn: closes[s].at(-1) / closes[s][0] - 1,
      annualVol: volatility(returns[s]).annual,
      sharpe: sharpeRatio(returns[s], config.riskFreeRate),
      maxDrawdown: maxDrawdown(closes[s]).maxDrawdown,
      beta: indexReturns ? betaVsIndex(returns[s], indexReturns, config.riskFreeRate).beta : null,
    })),
  });
}));

// ---------- background jobs ----------
const mcSchema = z.object({ symbol: symbolSchema, range: rangeSchema.default("2y"), days: z.number().int().min(5).max(504).default(126), paths: z.number().int().min(100).max(5000).default(1000), seed: z.number().int().optional() });
const operand = z.union([z.number(), z.object({ ind: z.enum(INDICATORS), period: z.number().int().min(2).max(400).optional() })]);
const condition = z.object({ left: operand, op: z.enum(["crossesAbove", "crossesBelow", ">", "<"]), right: operand });
const strategySchema = z.object({
  name: z.string().max(80).optional(),
  entry: z.array(condition).min(1).max(5),
  exit: z.array(condition).min(1).max(5),
  stopLoss: z.number().gt(0).lt(1).nullable().optional(),
  takeProfit: z.number().gt(0).lt(5).nullable().optional(),
  feeBps: z.number().min(0).max(100).optional(),
});
const btSchema = z.object({ symbol: symbolSchema, range: rangeSchema.default("5y"), strategy: strategySchema, initialCapital: z.number().positive().max(1e9).default(10000) });
const efSchema = z.object({ symbols: z.array(symbolSchema).min(2).max(10), range: rangeSchema.default("2y"), samples: z.number().int().min(500).max(20000).default(4000) });

api.post("/jobs/montecarlo", h(async (req, res) => res.status(202).json(await enqueue("montecarlo", parse(mcSchema, req.body), req.user?.id))));

api.post("/jobs/backtest", requirePro, h(async (req, res) => {
  const body = parse(btSchema, req.body);
  const errors = validateStrategy(body.strategy);
  if (errors.length) return res.status(400).json({ error: errors.join("; ") });
  res.status(202).json(await enqueue("backtest", body, req.user.id));
}));

api.post("/jobs/frontier", requirePro, h(async (req, res) => res.status(202).json(await enqueue("frontier", parse(efSchema, req.body), req.user.id))));

api.get("/jobs/:id", h(async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found or expired" });
  res.json(job);
}));

api.get("/strategies/presets", (_req, res) => res.json({ presets: PRESETS, indicators: INDICATORS }));

// ---------- watchlist (signed in; free plan capped) ----------
api.get("/watchlist", requireAuth, h(async (req, res) => res.json({ items: await db.watchlist.list(req.user.id), limit: req.user.plan === "pro" ? null : FREE_WATCHLIST_LIMIT })));

api.post("/watchlist", requireAuth, h(async (req, res) => {
  const { symbol } = parse(z.object({ symbol: symbolSchema }), req.body);
  if (req.user.plan !== "pro" && (await db.watchlist.count(req.user.id)) >= FREE_WATCHLIST_LIMIT) {
    return res.status(402).json({ error: `Free plan watchlists hold ${FREE_WATCHLIST_LIMIT} symbols. Upgrade to Pro for unlimited.`, upgrade: true });
  }
  await db.watchlist.add(req.user.id, symbol);
  res.status(201).json({ items: await db.watchlist.list(req.user.id) });
}));

api.delete("/watchlist/:symbol", requireAuth, h(async (req, res) => {
  await db.watchlist.remove(req.user.id, normaliseSymbol(req.params.symbol));
  res.json({ items: await db.watchlist.list(req.user.id) });
}));

// ---------- my portfolio: the user's real holdings (signed in) ----------
const MAX_HOLDINGS = 50;
const holdingSchema = z.object({ symbol: symbolSchema, quantity: z.number().positive().max(1e9), avgPrice: z.number().min(0).max(1e9) });

api.get("/holdings", requireAuth, h(async (req, res) => res.json({ holdings: await db.holdings.list(req.user.id) })));

api.post("/holdings", requireAuth, h(async (req, res) => {
  const body = parse(holdingSchema, req.body);
  const list = await db.holdings.list(req.user.id);
  if (list.length >= MAX_HOLDINGS && !list.some((x) => x.symbol === body.symbol)) return res.status(400).json({ error: `A portfolio can hold up to ${MAX_HOLDINGS} stocks` });
  await getHistory(body.symbol, "6mo"); // rejects symbols with no price data
  await db.holdings.add(req.user.id, body);
  res.status(201).json({ holdings: await db.holdings.list(req.user.id) });
}));

api.patch("/holdings/:id", requireAuth, h(async (req, res) => {
  const body = parse(holdingSchema.pick({ quantity: true, avgPrice: true }), req.body);
  const updated = await db.holdings.update(req.user.id, req.params.id, body);
  if (!updated) return res.status(404).json({ error: "Holding not found" });
  res.json({ holdings: await db.holdings.list(req.user.id) });
}));

api.delete("/holdings/:id", requireAuth, h(async (req, res) => {
  await db.holdings.remove(req.user.id, req.params.id);
  res.json({ holdings: await db.holdings.list(req.user.id) });
}));

/** Step 1 of an import: map each broker row (symbol, company name or ISIN) to a ticker. */
api.post("/holdings/resolve", requireAuth, h(async (req, res) => {
  const { items } = parse(z.object({ items: z.array(z.object({ symbol: z.string().max(40).optional(), name: z.string().max(200).optional(), isin: z.string().max(20).optional() })).min(1).max(MAX_HOLDINGS) }), req.body);
  const out = [];
  for (const it of items) out.push(await resolveSymbol(it).catch(() => ({ symbol: null, name: null, via: "none" })));
  res.json({ results: out });
}));

/** Step 2 of an import: save the confirmed rows, replacing or merging with what is there. */
api.post("/holdings/import", requireAuth, h(async (req, res) => {
  const { rows, mode } = parse(z.object({ rows: z.array(holdingSchema).min(1).max(MAX_HOLDINGS), mode: z.enum(["replace", "merge"]).default("replace") }), req.body);
  if (mode === "replace") await db.holdings.clear(req.user.id);
  for (const r of rows) await db.holdings.add(req.user.id, { ...r, source: "import" });
  res.status(201).json({ holdings: await db.holdings.list(req.user.id) });
}));

/** Portfolio analysis and "what if I invest more?" run as a background job. */
api.post("/jobs/myportfolio", requireAuth, h(async (req, res) => {
  const body = parse(z.object({
    range: rangeSchema.default("1y"),
    days: z.number().int().min(5).max(504).default(126),
    add: z.object({ symbol: symbolSchema, amount: z.number().positive().max(1e10) }).nullable().optional(),
  }), req.body);
  const holdings = (await db.holdings.list(req.user.id)).map(({ symbol, quantity, avgPrice }) => ({ symbol, quantity, avgPrice }));
  if (!holdings.length && !body.add) return res.status(400).json({ error: "Add a stock to your portfolio first" });
  res.status(202).json(await enqueue("myportfolio", { holdings, add: body.add ?? null, range: body.range, days: body.days }, req.user.id));
}));

/** Each holding analysed on its own: signals, risk and its own Monte Carlo forecast. */
api.post("/jobs/holdingsreport", requireAuth, h(async (req, res) => {
  const body = parse(z.object({ days: z.number().int().min(5).max(504).default(126) }), req.body);
  const holdings = (await db.holdings.list(req.user.id)).map(({ symbol, quantity, avgPrice }) => ({ symbol, quantity, avgPrice }));
  if (!holdings.length) return res.status(400).json({ error: "Add a stock to your portfolio first" });
  res.status(202).json(await enqueue("holdingsreport", { holdings, days: body.days }, req.user.id));
}));

// ---------- saved strategies (Pro) ----------
api.get("/strategies", requirePro, h(async (req, res) => res.json({ strategies: await db.strategies.list(req.user.id) })));

api.post("/strategies", requirePro, h(async (req, res) => {
  const body = parse(z.object({ name: z.string().min(1).max(80), symbol: symbolSchema.optional(), config: strategySchema, lastResult: z.any().optional() }), req.body);
  res.status(201).json({ strategy: await db.strategies.create(req.user.id, body) });
}));

api.delete("/strategies/:id", requirePro, h(async (req, res) => {
  await db.strategies.remove(req.user.id, req.params.id);
  res.status(204).end();
}));

// ---------- price alerts (Pro) ----------
api.get("/alerts", requirePro, h(async (req, res) => res.json({ alerts: await db.alerts.list(req.user.id) })));

api.post("/alerts", requirePro, h(async (req, res) => {
  const body = parse(z.object({ symbol: symbolSchema, direction: z.enum(["above", "below"]), target: z.number().positive() }), req.body);
  res.status(201).json({ alert: await db.alerts.create(req.user.id, body) });
}));

api.delete("/alerts/:id", requirePro, h(async (req, res) => {
  await db.alerts.remove(req.user.id, req.params.id);
  res.status(204).end();
}));
