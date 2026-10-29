// Turns what a broker file contains (an NSE symbol, a company name or an ISIN)
// into a Yahoo Finance ticker such as TCS.NS. Indian listings are preferred,
// since Groww and Zerodha statements are for NSE/BSE stocks.
import { search } from "./market.js";

const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const rank = (sym) => (sym.endsWith(".NS") ? 0 : sym.endsWith(".BO") ? 1 : 2);

function best(results, wanted) {
  if (!results?.length) return null;
  const equities = results.filter((r) => r.type !== "INDEX");
  const pool = equities.length ? equities : results;
  if (wanted) {
    const exact = pool.find((r) => r.symbol === `${wanted}.NS`) ?? pool.find((r) => r.symbol === `${wanted}.BO`) ?? pool.find((r) => r.symbol === wanted);
    if (exact) return exact;
  }
  return [...pool].sort((a, b) => rank(a.symbol) - rank(b.symbol))[0];
}

/** @returns {Promise<{symbol: string|null, name: string|null, via: string}>} */
export async function resolveSymbol({ symbol, name, isin }) {
  const sym = String(symbol ?? "").trim().toUpperCase();
  const code = String(isin ?? "").trim().toUpperCase();

  if (code && ISIN.test(code)) {
    const hit = best(await search(code));
    if (hit) return { symbol: hit.symbol, name: hit.name, via: "isin" };
  }
  if (sym) {
    if (/[.^=]/.test(sym)) return { symbol: sym, name: null, via: "symbol" };
    const hit = best(await search(sym), sym);
    if (hit) return { symbol: hit.symbol, name: hit.name, via: "symbol" };
  }
  if (name) {
    const cleaned = String(name).replace(/\b(ltd|limited|inc|corp|corporation|plc)\b\.?/gi, "").replace(/\s+/g, " ").trim();
    const hit = best(await search(cleaned));
    if (hit) return { symbol: hit.symbol, name: hit.name, via: "name" };
  }
  return { symbol: null, name: null, via: "none" };
}
