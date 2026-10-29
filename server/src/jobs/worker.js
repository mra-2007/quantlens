// Standalone worker process: `npm run worker` (requires REDIS_URL).
import { config } from "../config.js";
import { startWorker } from "./queue.js";

if (!config.redisUrl) {
  console.error("REDIS_URL is not set. Without Redis, jobs run inside the API process; no separate worker needed.");
  process.exit(1);
}
startWorker();
