const BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_KEY = "quantlens.token";

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.upgrade = !!body?.upgrade;
  }
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const headers = { Accept: "application/json" };
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("Can't reach the QuantLens server. Check that the API is running.", 0);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data);
  return data;
}

/** Submits a background job and polls until it completes. */
export async function runJob(type, payload, { onState, signal } = {}) {
  const { id, state } = await api(`/jobs/${type}`, { method: "POST", body: payload, signal });
  onState?.(state);
  let delay = 250;
  for (;;) {
    const job = await api(`/jobs/${id}`, { signal });
    onState?.(job.state);
    if (job.state === "completed") return job.result;
    if (job.state === "failed") throw new ApiError(job.error ?? "The computation failed", 500);
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 2000);
  }
}
