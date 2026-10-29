import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db/index.js";

export const signToken = (user) => jwt.sign({ sub: user.id, plan: user.plan }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

export const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, plan: u.plan });

/** Attaches req.user when a valid Bearer token is present; never rejects. */
export async function optionalAuth(req, _res, next) {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ")) {
    try {
      const payload = jwt.verify(h.slice(7), config.jwtSecret);
      const user = await db.users.byId(payload.sub);
      if (user) req.user = user;
    } catch {
      /* invalid or expired token: treat as anonymous */
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in to use this feature" });
  next();
}

export function requirePro(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in to use this feature" });
  if (req.user.plan !== "pro") return res.status(402).json({ error: "This feature is part of QuantLens Pro", upgrade: true });
  next();
}
