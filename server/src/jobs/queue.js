// Job queue facade. With REDIS_URL: BullMQ queue (run `npm run worker`, or let the
// API run an inline worker via INLINE_WORKER=true). Without Redis: an in-process
// queue with the same API, so the frontend code path is identical.
import crypto from "node:crypto";
import { Queue, Worker, QueueEvents } from "bullmq";
import { config } from "../config.js";
import { handlers } from "./handlers.js";
import { cache } from "../lib/cache.js";

const QUEUE = "quantlens-compute";
const connection = () => ({ url: config.redisUrl, maxRetriesPerRequest: null });

let bull = null;
const local = new Map(); // id -> { state, result, error, createdAt }

/** Identical inputs return the same job result from cache. */
const resultKey = (type, data) => `job:${type}:${crypto.createHash("sha1").update(JSON.stringify(data)).digest("hex")}`;

export async function enqueue(type, data, userId) {
  if (!handlers[type]) throw new Error(`Unknown job type ${type}`);
  const key = resultKey(type, data);
  const cached = await cache.get(key);
  if (cached) {
    const id = `cached-${crypto.randomUUID()}`;
    local.set(id, { state: "completed", result: cached, userId, createdAt: Date.now() });
    return { id, state: "completed" };
  }

  if (config.redisUrl) {
    bull ??= new Queue(QUEUE, { connection: connection() });
    const job = await bull.add(type, { data, key, userId }, { removeOnComplete: { age: 3600 }, removeOnFail: { age: 3600 }, attempts: 1 });
    return { id: `bull-${job.id}`, state: "queued" };
  }

  const id = crypto.randomUUID();
  local.set(id, { state: "queued", userId, createdAt: Date.now() });
  setImmediate(async () => {
    const entry = local.get(id);
    entry.state = "active";
    try {
      entry.result = await handlers[type](data);
      entry.state = "completed";
      await cache.set(key, entry.result, 60 * 30);
    } catch (e) {
      entry.state = "failed";
      entry.error = e.message;
    }
  });
  // Drop finished local jobs after an hour.
  for (const [k, v] of local) if (Date.now() - v.createdAt > 3600_000) local.delete(k);
  return { id, state: "queued" };
}

export async function getJob(id) {
  if (id.startsWith("bull-")) {
    bull ??= new Queue(QUEUE, { connection: connection() });
    const job = await bull.getJob(id.slice(5));
    if (!job) return null;
    const state = await job.getState();
    return {
      state: state === "waiting" || state === "delayed" ? "queued" : state,
      result: state === "completed" ? job.returnvalue : undefined,
      error: state === "failed" ? job.failedReason : undefined,
      progress: job.progress,
    };
  }
  const e = local.get(id);
  return e ? { state: e.state, result: e.result, error: e.error } : null;
}

export function startWorker() {
  if (!config.redisUrl) return null;
  const worker = new Worker(
    QUEUE,
    async (job) => {
      const result = await handlers[job.name](job.data.data);
      await cache.set(job.data.key, result, 60 * 30);
      return result;
    },
    { connection: connection(), concurrency: 2 },
  );
  worker.on("failed", (job, err) => console.error(`[worker] ${job?.name} failed:`, err.message));
  console.log("[worker] listening on queue", QUEUE);
  return worker;
}

export { QueueEvents };
