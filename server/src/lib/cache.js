// Cache facade: Redis when REDIS_URL is set, otherwise an in-process TTL map.
import Redis from "ioredis";
import { config } from "../config.js";

let redis = null;
const memory = new Map();

export function getRedis() {
  if (!config.redisUrl) return null;
  if (!redis) {
    redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
    redis.on("error", (e) => console.error("[redis]", e.message));
  }
  return redis;
}

export const cache = {
  kind: () => (config.redisUrl ? "redis" : "memory"),

  async get(key) {
    const r = getRedis();
    if (r) {
      const raw = await r.get(key);
      return raw ? JSON.parse(raw) : null;
    }
    const hit = memory.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) {
      memory.delete(key);
      return null;
    }
    return hit.value;
  },

  async set(key, value, ttlSeconds) {
    const r = getRedis();
    if (r) return r.set(key, JSON.stringify(value), "EX", ttlSeconds);
    if (memory.size > 2000) memory.delete(memory.keys().next().value);
    memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
  },

  /** Read-through helper: returns cached value or computes, stores and returns it. */
  async wrap(key, ttlSeconds, compute) {
    const hit = await this.get(key);
    if (hit !== null) return { value: hit, cached: true };
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return { value, cached: false };
  },
};
