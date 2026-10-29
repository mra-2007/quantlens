// Price-alert checker: polls active Pro alerts and emails the owner when a target is crossed.
import nodemailer from "nodemailer";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { getLatestPrice } from "./market.js";

const transport = config.smtp.host
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null;

async function notify(alert, price) {
  const subject = `${alert.symbol} is ${alert.direction} ${alert.target}`;
  const text = `Your QuantLens alert fired.\n\n${alert.symbol} last traded at ${price.toFixed(2)}, ${alert.direction} your target of ${alert.target}.\n\nThis alert is now switched off. Create a new one in QuantLens to keep watching.`;
  if (!transport) {
    console.log(`[alerts] (no SMTP configured) would email ${alert.email}: ${subject}`);
    return;
  }
  const info = await transport.sendMail({ from: config.smtp.from, to: alert.email, subject, text });
  console.log(`[alerts] emailed ${alert.email}: ${subject} (${info.response})`);
}

export async function checkAlerts() {
  const active = await db.alerts.active();
  const bySymbol = new Map();
  for (const a of active) bySymbol.set(a.symbol, [...(bySymbol.get(a.symbol) ?? []), a]);
  if (active.length) console.log(`[alerts] checking ${active.length} active alert(s); email ${transport ? "on (" + config.smtp.user + ")" : "OFF: SMTP not configured"}`);
  let fired = 0;
  for (const [symbol, alerts] of bySymbol) {
    let price;
    try {
      price = await getLatestPrice(symbol);
    } catch (e) {
      console.error(`[alerts] price for ${symbol} failed:`, e.message);
      continue;
    }
    if (price == null) continue;
    for (const a of alerts) {
      const hit = a.direction === "above" ? price >= a.target : price <= a.target;
      if (!hit) continue;
      await db.alerts.trigger(a.id, price);
      await notify(a, price).catch((e) => console.error("[alerts] email failed:", e.message));
      fired++;
    }
  }
  return fired;
}

export function startAlertLoop() {
  const run = () => checkAlerts().catch((e) => console.error("[alerts]", e.message));
  setTimeout(run, 10_000);
  return setInterval(run, config.alertIntervalMs);
}
