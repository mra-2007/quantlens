import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { runJob } from "../lib/api";
import { fmt, tone } from "../lib/format";
import FanChart from "./FanChart";
import { ErrorNote, Skeleton, Seg } from "./ui";

const STANCE_TONE = { "Mostly bullish": "up", "Mostly bearish": "down", Mixed: "" };
const VOTE_TONE = { 1: "up", "-1": "down", 0: "" };

/** Formats a signal's value the way it is defined: ratios as %, oscillators as plain numbers. */
function signalValue(s) {
  if (s.name.startsWith("Price vs") || s.name.startsWith("SMA") || s.name.includes("slope")) return fmt.pct(s.value);
  if (s.name.startsWith("Bollinger")) return fmt.num(s.value, 2);
  if (s.name.startsWith("MACD")) return fmt.num(s.value, 2);
  return fmt.num(s.value, 1);
}

/**
 * Every holding analysed on its own: trend and momentum signals, risk, and that
 * stock's Monte Carlo forecast applied to the user's quantity.
 */
export default function HoldingsReport({ holdings, horizon, setHorizon, horizons, horizonWords }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!holdings.length) return undefined;
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    runJob("holdingsreport", { days: horizons[horizon] }, { signal: ctl.signal })
      .then((r) => { setReport(r); setOpen((o) => o ?? r.stocks.find((s) => !s.error)?.symbol ?? null); })
      .catch((e) => e.name !== "AbortError" && setError(e))
      .finally(() => setBusy(false));
    return () => ctl.abort();
  }, [holdings, horizon, horizons]);

  if (!holdings.length) return null;
  const words = horizonWords[horizon];

  return (
    <section className="panel stack" style={{ "--gap": "14px" }}>
      <div className="panel-head">
        <div>
          <h2 className="h3">Each stock, analysed {busy && <span className="faint small" style={{ fontWeight: 400 }}>· calculating…</span>}</h2>
          <p className="faint small">Two years of daily prices per stock. Signals are mechanical rules, the forecast is a 1,000-path Monte Carlo simulation. Click a row for the details.</p>
        </div>
        <Seg label="Forecast horizon" value={horizon} options={Object.keys(horizons)} onChange={setHorizon} />
      </div>
      <ErrorNote error={error} />
      {!report ? <Skeleton h={260} /> : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>Stock</th>
                <th className="r">Price</th>
                <th>Signals</th>
                <th className="r">RSI</th>
                <th className="r">Volatility</th>
                <th className="r">Sharpe</th>
                <th className="r">Expected price in {words}</th>
                <th className="r">Chance up</th>
                <th className="r">Your position → expected</th>
              </tr>
            </thead>
            <tbody>
              {report.stocks.map((s) => s.error ? (
                <tr key={s.symbol}><td><b>{s.symbol}</b></td><td colSpan={8} className="faint small">{s.error}</td></tr>
              ) : (
                <Fragment key={s.symbol}>
                  <tr onClick={() => setOpen(open === s.symbol ? null : s.symbol)} style={{ cursor: "pointer" }} aria-expanded={open === s.symbol}>
                    <td><b>{open === s.symbol ? "▾" : "▸"} {s.symbol}</b><div className="faint small">{s.name}</div></td>
                    <td className="r">{fmt.money(s.price, s.currency)}<div className={`small ${tone(s.changePct)}`}>{fmt.pct(s.changePct, 2)}</div></td>
                    <td>
                      <span className={`badge ${STANCE_TONE[s.verdict.stance]}`}>{s.verdict.stance}</span>
                      <div className="faint small" style={{ marginTop: 4 }}><span className="up">{s.verdict.bullish}▲</span> <span className="down">{s.verdict.bearish}▼</span> {s.verdict.neutral} neutral</div>
                    </td>
                    <td className="r">{fmt.num(s.momentum.rsi, 0)}</td>
                    <td className="r">{fmt.pctAbs(s.risk.annualVol, 0)}</td>
                    <td className={`r ${tone(s.risk.sharpe)}`}>{fmt.num(s.risk.sharpe)}</td>
                    <td className="r"><b>{fmt.money(s.forecast.median, s.currency)}</b><div className="faint small">{fmt.money(s.forecast.p5, s.currency, 0)} – {fmt.money(s.forecast.p95, s.currency, 0)}</div></td>
                    <td className="r"><b className={s.forecast.probUp >= 0.5 ? "up" : "down"}>{fmt.pctAbs(s.forecast.probUp, 0)}</b></td>
                    <td className="r">{fmt.money(s.forecast.position.now, s.currency, 0)} → <b>{fmt.money(s.forecast.position.median, s.currency, 0)}</b><div className={`small ${tone(s.forecast.expectedReturn)}`}>{fmt.pct(s.forecast.expectedReturn)}</div></td>
                  </tr>
                  {open === s.symbol && (
                    <tr>
                      <td colSpan={9} style={{ background: "var(--panel-2)" }}>
                        <StockDetail s={s} words={words} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="faint small">Statistics from past prices, not investment advice. The forecast assumes the stock keeps its past average drift and volatility (geometric Brownian motion).</p>
    </section>
  );
}

function StockDetail({ s, words }) {
  const f = s.forecast;
  const cur = s.currency;
  const risk = [
    ["Annual volatility", fmt.pctAbs(s.risk.annualVol), "σ_daily · √252"],
    ["Sharpe ratio", fmt.num(s.risk.sharpe), "(252μ − r_f) / (σ√252)"],
    ["Maximum drawdown", fmt.pct(s.risk.maxDrawdown), "min(P / running peak − 1)"],
    ["1-day VaR (95%)", fmt.pctAbs(s.risk.var95, 2), "5th percentile of daily returns"],
    ["Beta", fmt.num(s.risk.beta), `cov(r, r_m) / var(r_m)${s.index ? ` vs ${s.index}` : ""}`],
    ["1-year return", fmt.pct(s.risk.return1y), "P_today / P_1y ago − 1"],
    ["52-week range", `${fmt.money(s.low52, cur, 0)} – ${fmt.money(s.high52, cur, 0)}`, "min / max of daily lows and highs"],
    ["Your P&L", `${fmt.money(s.pnl, cur, 0)} (${fmt.pct(s.pnlPct)})`, `${fmt.num(s.quantity, s.quantity % 1 ? 2 : 0)} × (P − ${fmt.money(s.avgPrice, cur)})`],
  ];
  return (
    <div className="grid g3" style={{ alignItems: "start", padding: "8px 4px" }}>
      <div className="stack" style={{ "--gap": "8px" }}>
        <h3 className="h3" style={{ fontSize: 16 }}>Signals</h3>
        {s.signals.map((g) => (
          <div key={g.name} className="spread small" title={g.formula}>
            <span>{g.name}<div className="faint" style={{ fontSize: 11 }}>{g.formula}</div></span>
            <span style={{ textAlign: "right" }}><b>{signalValue(g)}</b><div className={VOTE_TONE[g.vote]}>{g.state}</div></span>
          </div>
        ))}
        <p className="faint small">Score = (bullish − bearish) / {s.signals.length} = <b>{fmt.num(s.verdict.score)}</b></p>
      </div>
      <div className="stack" style={{ "--gap": "8px" }}>
        <h3 className="h3" style={{ fontSize: 16 }}>Risk</h3>
        {risk.map(([k, v, formula]) => (
          <div key={k} className="spread small">
            <span>{k}<div className="faint" style={{ fontSize: 11 }}>{formula}</div></span>
            <b style={{ textAlign: "right" }}>{v}</b>
          </div>
        ))}
      </div>
      <div className="stack" style={{ "--gap": "8px" }}>
        <h3 className="h3" style={{ fontSize: 16 }}>Forecast, {words}</h3>
        <FanChart result={f} history={f.history} currency={cur} height={220} />
        <p className="small muted">
          Daily drift μ = {fmt.num(f.drift * 100, 3)}%, σ = {fmt.num(f.sigma * 100, 2)}%. Most likely <b>{fmt.money(f.median, cur)}</b>; 90% of paths end between {fmt.money(f.p5, cur, 0)} and {fmt.money(f.p95, cur, 0)}.
          {" "}<b>{fmt.pctAbs(f.probUp, 0)}</b> chance of ending above today, {fmt.pctAbs(f.probLoss10, 0)} chance of falling more than 10%.
        </p>
        <p className="small">Your {fmt.num(s.quantity, s.quantity % 1 ? 2 : 0)} shares: {fmt.money(f.position.now, cur, 0)} today → <b>{fmt.money(f.position.median, cur, 0)}</b> likely (bad case {fmt.money(f.position.p5, cur, 0)}, good case {fmt.money(f.position.p95, cur, 0)}).</p>
        <Link to={`/s/${encodeURIComponent(s.symbol)}`} className="btn sm">Open full chart and indicators →</Link>
      </div>
    </div>
  );
}
