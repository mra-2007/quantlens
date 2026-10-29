import "dotenv/config";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  nodeEnv: env.NODE_ENV ?? "development",
  corsOrigin: (env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),

  // "yahoo" (default, no key), "alphavantage" (needs ALPHAVANTAGE_KEY) or "demo" (simulated, offline)
  dataProvider: env.DATA_PROVIDER ?? "yahoo",
  alphaVantageKey: env.ALPHAVANTAGE_KEY ?? "",

  jwtSecret: env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: env.JWT_EXPIRES_IN ?? "7d",

  // Optional infrastructure. Without them the API falls back to in-memory equivalents,
  // so `npm run dev` works on a laptop with nothing else installed.
  databaseUrl: env.DATABASE_URL ?? "",
  redisUrl: env.REDIS_URL ?? "",

  cacheTtl: {
    history: Number(env.CACHE_TTL_HISTORY ?? 60 * 60 * 6), // 6h for daily candles
    quote: Number(env.CACHE_TTL_QUOTE ?? 60),
    search: Number(env.CACHE_TTL_SEARCH ?? 60 * 60 * 24),
  },

  riskFreeRate: Number(env.RISK_FREE_RATE ?? 0.04),
  defaultIndex: env.DEFAULT_INDEX ?? "^GSPC",

  smtp: {
    host: env.SMTP_HOST ?? "",
    port: Number(env.SMTP_PORT ?? 587),
    user: env.SMTP_USER ?? "",
    pass: env.SMTP_PASS ?? "",
    from: env.ALERT_FROM ?? "QuantLens <alerts@quantlens.local>",
  },
  alertIntervalMs: Number(env.ALERT_INTERVAL_MS ?? 5 * 60 * 1000),

  // When true, the API process also runs the job worker (handy for single-dyno deploys).
  inlineWorker: (env.INLINE_WORKER ?? "true") === "true",
  // Payments: with Razorpay keys set, Pro is bought through Razorpay Checkout (use rzp_test_ keys
  // for test mode). Without keys, a free demo upgrade is used so the project still runs.
  razorpay: {
    keyId: env.RAZORPAY_KEY_ID ?? "",
    keySecret: env.RAZORPAY_KEY_SECRET ?? "",
  },
  proPricePaise: Number(env.PRO_PRICE_PAISE ?? 39900), // ₹399
  allowSelfUpgrade: (env.ALLOW_SELF_UPGRADE ?? "true") === "true",
};

if (config.nodeEnv === "production" && config.jwtSecret === "dev-only-secret-change-me") {
  throw new Error("Set JWT_SECRET in production");
}
