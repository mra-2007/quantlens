import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { optionalAuth } from "./lib/auth.js";
import { api } from "./routes/api.js";
import { startWorker } from "./jobs/queue.js";
import { startAlertLoop } from "./lib/alerts.js";

export function createApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: false }));
  app.use(express.json({ limit: "200kb" }));
  app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));
  // Brute-force protection on credential endpoints only (not /auth/me, which runs on every page load).
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });
  app.use(["/api/auth/login", "/api/auth/register"], authLimit);
  app.use("/api", optionalAuth, api);
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && config.nodeEnv === "production" ? "Something went wrong on our side" : err.message });
  });
  return app;
}

// Start only when run directly (works on Windows and Unix paths).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await db.migrate();
  const app = createApp();
  app.listen(config.port, () => {
    console.log(`QuantLens API on :${config.port} | data=${config.dataProvider} db=${db.kind} cache=${config.redisUrl ? "redis" : "memory"} queue=${config.redisUrl ? "bullmq" : "in-process"}`);
  });
  if (config.redisUrl && config.inlineWorker) startWorker();
  startAlertLoop();
}
