import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api, runJob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, tone, C } from "../lib/format";
import { readRows, detectHoldings } from "../lib/brokerImport";
import FanChart from "../components/FanChart";
import Heatmap from "../components/Heatmap";
import HoldingsReport from "../components/HoldingsReport";
import XRay from "../components/XRay";
import { SymbolSearch, ErrorNote, SimNote, Seg, ChartTip, Skeleton, Metric } from "../components/ui";

const HORIZONS = { "1M": 21, "6M": 126, "1Y": 252 };
const HORIZON_WORDS = { "1M": "1 month", "6M": "6 months", "1Y": "1 year" };

export default function MyPortfolio() {
  const { user, ready } = useAuth();
  const [holdings, setHoldings] = useState(null);
  const [panel, setPanel] = useState(null); // "add" | "import" | null
  const [range, setRange] = useState("1y");
  const [horizon, setHorizon] = useState("6M");
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "My portfolio / QuantLens";
    if (user) api("/holdings").then((d) => setHoldings(d.holdings)).catch(setError);
  }, [user]);

  const analyse = useCallback(() => {
    if (!holdings?.length) { setAnalysis(null); return undefined; }
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    runJob("myportfolio", { range, days: HORIZONS[horizon] }, { signal: ctl.signal })
      .then(setAnalysis)
      .catch((e) => e.name !== "AbortError" && setError(e))
      .finally(() => setBusy(false));
    return () => ctl.abort();
  }, [holdings, range, horizon]);

  useEffect(() => analyse(), [analyse]);

  if (!ready) return <Skeleton h={300} />;
  if (!user) return <Navigate to="/login" replace />;

  const base = analysis?.base ?? "INR";
  const money = (v, d = 0) => fmt.money(v, base, d);
  const s = analysis?.summary;
  const byId = Object.fromEntries((holdings ?? []).map((h) => [h.symbol, h.id]));

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>My portfolio</h1>
          <p className="muted">Your real holdings, analysed with the same maths: value, profit, risk and what happens if you invest more.</p>
        </div>
        <div className="row">
          <button className={`btn ${panel === "add" ? "" : "primary"}`} onClick={() => setPanel(panel === "add" ? null : "add")}>Add a stock</button>
          <button className="btn" onClick={() => setPanel(panel === "import" ? null : "import")}>Import from Groww or CSV</button>
        </div>
      </div>

      {panel === "add" && <AddHolding onSaved={(h) => { setHoldings(h); setPanel(null); }} />}
      {panel === "import" && <ImportHoldings hasHoldings={!!holdings?.length} onSaved={(h) => { setHoldings(h); setPanel(null); }} />}

      <ErrorNote error={error} />
      {analysis && <SimNote show={analysis.simulated} />}

      {holdings === null ? <Skeleton h={200} /> : holdings.length === 0 ? (panel ? null :
        <section className="panel gate">
          <h2 className="h2">Start with what you own</h2>
          <p className="muted">Add each stock with the quantity and average price you bought at, or import the holdings statement from Groww (Profile → Reports → Stocks → Holdings statement), Zerodha or any CSV.</p>
          <div className="row" style={{ justifyContent: "center" }}>
            <button className="btn primary" onClick={() => setPanel("add")}>Add a stock</button>
            <button className="btn" onClick={() => setPanel("import")}>Import a file</button>
          </div>
        </section>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Current value" value={s ? money(s.value) : "…"} formula={s ? `as of ${s.asOf}` : ""} />
            <Metric label="Invested" value={s ? money(s.cost) : "…"} formula="Σ quantity × average price" />
            <Metric label="Total profit / loss" value={s ? money(s.pnl) : "…"} tone={tone(s?.pnl)} formula={s ? fmt.pct(s.pnlPct) : ""} />
            <Metric label="Today" value={s ? money(s.dayChange) : "…"} tone={tone(s?.dayChange)} formula={s ? fmt.pct(s.dayChangePct, 2) : ""} />
          </div>

          <HoldingsTable holdings={holdings} positions={analysis?.positions} byId={byId} base={base} onChange={setHoldings} />

          <div className="spread">
            <h2 className="h3">Analysis {busy && <span className="faint small" style={{ fontWeight: 400 }}>· calculating…</span>}</h2>
            <Seg label="History" value={range} options={["6mo", "1y", "2y", "5y"]} onChange={setRange} />
          </div>

          {!analysis ? <Skeleton h={380} /> : (
            <>
              <div className="grid g2">
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <h3 className="h3">Value trend</h3>
                      <p className="faint small">Today’s quantities priced over the last {range}{analysis.converted ? `, USD converted at ₹${fmt.num(analysis.fxRate)}` : ""}</p>
                    </div>
                    <span className={tone(analysis.risk.totalReturn)} style={{ fontWeight: 600 }}>{fmt.pct(analysis.risk.totalReturn)}</span>
                  </div>
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={analysis.trend} margin={{ left: 0, right: 8, top: 4 }}>
                      <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                      <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={50} tickFormatter={(t) => t.slice(0, 7)} />
                      <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={70} domain={["auto", "auto"]} tickFormatter={(v) => fmt.compact(v)} />
                      <Tooltip content={<ChartTip format={(v) => money(v)} />} />
                      <Area dataKey="value" name="Portfolio value" stroke={C.amber} fill={C.amber} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </section>
                <section className="panel">
                  <div className="panel-head">
                    <h3 className="h3">Allocation</h3>
                    <span className="faint small">Behaves like {fmt.num(analysis.risk.effectiveHoldings, 1)} equal stocks (1 / Σw²)</span>
                  </div>
                  <div className="stack" style={{ "--gap": "10px" }}>
                    {analysis.positions.map((p) => (
                      <div key={p.symbol}>
                        <div className="spread small"><b>{p.symbol}</b><span>{fmt.pctAbs(p.weight, 1)} · {money(p.value)}</span></div>
                        <div style={{ height: 6, background: C.rule, borderRadius: 3, marginTop: 4 }}>
                          <div style={{ width: `${p.weight * 100}%`, height: "100%", background: C.amber, borderRadius: 3 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {analysis.risk.topWeight > 0.4 && <p className="small" style={{ marginTop: 14, color: C.amber }}>{fmt.pctAbs(analysis.risk.topWeight, 0)} of your money is in one stock, so its moves dominate your portfolio.</p>}
                </section>
              </div>

              <section>
                <div className="panel-head"><h3 className="h3">Portfolio risk</h3><span className="faint small">From daily returns over {analysis.dates.sessions} sessions{analysis.index ? `, beta vs ${analysis.index}` : ""}</span></div>
                <div className="metrics">
                  <Metric label="Annual volatility" value={fmt.pctAbs(analysis.risk.annualVol)} formula="σ_daily · √252" />
                  <Metric label="Sharpe ratio" value={fmt.num(analysis.risk.sharpe)} tone={tone(analysis.risk.sharpe)} formula="(252μ − r_f) / (σ√252)" />
                  <Metric label="Maximum drawdown" value={fmt.pct(analysis.risk.maxDrawdown)} tone="down" formula={`${analysis.risk.drawdownFrom} → ${analysis.risk.drawdownTo}`} />
                  <Metric label="1-day VaR (95%)" value={money(analysis.risk.var95Money)} formula={`${fmt.pctAbs(analysis.risk.var95, 2)} of value`} />
                  <Metric label="Beta" value={fmt.num(analysis.risk.beta)} formula="cov(r, r_m) / var(r_m)" />
                  <Metric label="Sortino ratio" value={fmt.num(analysis.risk.sortino)} formula="(252μ − r_f) / (σ_down√252)" />
                  <Metric label="Return over range" value={fmt.pct(analysis.risk.totalReturn)} tone={tone(analysis.risk.totalReturn)} formula={`today’s quantities, ${range}`} />
                  <Metric label="Yearly growth (CAGR)" value={fmt.pct(analysis.risk.cagr)} tone={tone(analysis.risk.cagr)} formula={`over ${range}`} />
                </div>
              </section>

              <div className="grid g2">
                <section className="panel">
                  <div className="panel-head">
                    <h3 className="h3">Forecast for your portfolio</h3>
                    <Seg label="Horizon" value={horizon} options={Object.keys(HORIZONS)} onChange={setHorizon} />
                  </div>
                  <FanChart result={analysis.forecast} history={analysis.forecast.history} currency={base} />
                  <p className="small muted">In {HORIZON_WORDS[horizon]}: most likely <b>{money(analysis.forecast.median)}</b>, 90% range {money(analysis.forecast.p5)} to {money(analysis.forecast.p95)}, <b>{fmt.pctAbs(analysis.forecast.probProfit, 0)}</b> chance of being higher than today.</p>
                </section>
                <section className="panel">
                  <div className="panel-head"><h3 className="h3">How your stocks move together</h3><span className="faint small">Lower means better diversified</span></div>
                  {analysis.correlation ? <Heatmap symbols={analysis.correlation.symbols} matrix={analysis.correlation.matrix} /> : <p className="muted">Add a second stock to see how your holdings move together.</p>}
                </section>
              </div>
            </>
          )}
        </>
      )}

      {holdings?.length > 0 && <XRay holdings={holdings} />}

      {holdings?.length > 0 && <HoldingsReport holdings={holdings} horizon={horizon} setHorizon={setHorizon} horizons={HORIZONS} horizonWords={HORIZON_WORDS} />}

      {holdings !== null && <WhatIf holdings={holdings} range={range} horizon={horizon} setHorizon={setHorizon} base={base} />}
    </div>
  );
}

function AddHolding({ onSaved }) {
  const [symbol, setSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgPrice, setAvgPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      const d = await api("/holdings", { method: "POST", body: { symbol, quantity: Number(quantity), avgPrice: Number(avgPrice) } });
      onSaved(d.holdings);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel stack" style={{ "--gap": "14px" }}>
      <h2 className="h3">Add a stock you own</h2>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field">Stock
          <div className="row" style={{ gap: 8 }}>
            {symbol && <span className="badge" style={{ height: 38, fontSize: 14, color: C.chalk }}>{symbol}</span>}
            <div style={{ width: 240 }}><SymbolSearch placeholder={symbol ? "Change stock" : "Search, e.g. TCS"} onPick={setSymbol} /></div>
          </div>
        </label>
        <label className="field">Quantity<input className="input" style={{ width: 120 }} type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label>
        <label className="field">Average buy price<input className="input" style={{ width: 160 }} type="number" min="0" step="any" value={avgPrice} onChange={(e) => setAvgPrice(e.target.value)} /></label>
        <button className="btn primary" disabled={!symbol || !(quantity > 0) || avgPrice === "" || busy} onClick={save}>{busy ? "Adding…" : "Add to portfolio"}</button>
      </div>
      <p className="faint small">Price in the stock’s own currency (₹ for NSE stocks, $ for US stocks). Adding a stock you already hold merges them and averages the price.</p>
      <ErrorNote error={error} />
    </section>
  );
}

function ImportHoldings({ hasHoldings, onSaved }) {
  const [rows, setRows] = useState(null);
  const [columns, setColumns] = useState(null);
  const [mode, setMode] = useState(hasHoldings ? "replace" : "merge");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    setRows(null);
    setBusy("Reading the file…");
    try {
      const found = detectHoldings(await readRows(file));
      if (!found.items.length) throw new Error("The holdings table is empty.");
      setColumns(found.columns);
      setBusy(`Matching ${found.items.length} stocks…`);
      const { results } = await api("/holdings/resolve", { method: "POST", body: { items: found.items.map(({ symbol, name, isin }) => ({ symbol, name, isin })) } });
      setRows(found.items.map((it, i) => ({ ...it, ticker: results[i].symbol ?? "", matchedName: results[i].name, include: !!results[i].symbol })));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setBusy("Saving…");
    try {
      const chosen = rows.filter((r) => r.include && r.ticker).map((r) => ({ symbol: r.ticker.trim().toUpperCase(), quantity: Number(r.quantity), avgPrice: Number(r.avgPrice) }));
      const d = await api("/holdings/import", { method: "POST", body: { rows: chosen, mode } });
      onSaved(d.holdings);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  const update = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const included = rows?.filter((r) => r.include && r.ticker).length ?? 0;

  return (
    <section className="panel stack" style={{ "--gap": "14px" }}>
      <h2 className="h3">Import your holdings</h2>
      <p className="muted small" style={{ margin: 0 }}>
        <b>Groww:</b> Profile → Reports → Stocks → Holdings statement → download Excel. <b>Zerodha:</b> Console → Portfolio → Holdings → Download. Or any CSV with Symbol, Quantity and Avg Price columns. The file is read in your browser; only the stock, quantity and price are saved.
      </p>
      <input className="input" style={{ paddingTop: 6 }} type="file" accept=".xlsx,.csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Holdings file" />
      {busy && <p className="faint small">{busy}</p>}
      <ErrorNote error={error} />
      {rows && (
        <>
          <p className="faint small" style={{ margin: 0 }}>Columns found: {Object.entries(columns).filter(([, v]) => v).map(([k, v]) => `${k} = “${v}”`).join(", ")}. Check each ticker; fix any that are blank.</p>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Import</th><th>From your file</th><th>Ticker</th><th className="r">Quantity</th><th className="r">Avg price</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td><input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} aria-label={`Import ${r.name ?? r.symbol}`} /></td>
                    <td>{r.name ?? r.symbol}<div className="faint small">{r.isin ?? ""}{r.matchedName ? ` → ${r.matchedName}` : ""}</div></td>
                    <td><input className="input" style={{ width: 150, borderColor: r.ticker ? undefined : C.down }} value={r.ticker} placeholder="e.g. TCS.NS" onChange={(e) => update(i, { ticker: e.target.value, include: !!e.target.value })} /></td>
                    <td className="r"><input className="input num" style={{ width: 100 }} type="number" value={r.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                    <td className="r"><input className="input num" style={{ width: 120 }} type="number" value={r.avgPrice} onChange={(e) => update(i, { avgPrice: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            {hasHoldings && (
              <select className="select" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Import mode">
                <option value="replace">Replace my current holdings</option>
                <option value="merge">Add to my current holdings</option>
              </select>
            )}
            <button className="btn primary" disabled={!included || !!busy} onClick={save}>Import {included} stock{included === 1 ? "" : "s"}</button>
          </div>
        </>
      )}
    </section>
  );
}

function HoldingsTable({ holdings, positions, byId, base, onChange }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);
  const pos = Object.fromEntries((positions ?? []).map((p) => [p.symbol, p]));
  const order = positions ? positions.map((p) => p.symbol) : holdings.map((h) => h.symbol);
  const hold = Object.fromEntries(holdings.map((h) => [h.symbol, h]));

  const saveEdit = async (id) => {
    setError(null);
    try {
      const d = await api(`/holdings/${id}`, { method: "PATCH", body: { quantity: Number(draft.quantity), avgPrice: Number(draft.avgPrice) } });
      onChange(d.holdings);
      setEditing(null);
    } catch (e) {
      setError(e);
    }
  };
  const remove = async (id) => onChange((await api(`/holdings/${id}`, { method: "DELETE" })).holdings);

  return (
    <section className="panel">
      <div className="panel-head"><h2 className="h3">Holdings</h2><span className="faint small">{holdings.length} stock{holdings.length === 1 ? "" : "s"} · totals in {base}</span></div>
      <ErrorNote error={error} />
      <div className="scroll-x">
        <table className="table">
          <thead><tr><th>Stock</th><th className="r">Qty</th><th className="r">Avg price</th><th className="r">Price</th><th className="r">Value</th><th className="r">P&amp;L</th><th className="r">Weight</th><th /></tr></thead>
          <tbody>
            {order.filter((s) => hold[s]).map((sym) => {
              const h = hold[sym];
              const p = pos[sym];
              const id = byId[sym];
              const isEdit = editing === id;
              return (
                <tr key={sym}>
                  <td><b>{sym}</b><div className="faint small">{p?.name ?? ""}</div></td>
                  <td className="r">{isEdit ? <input className="input num" type="number" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} aria-label="Quantity" /> : fmt.num(h.quantity, h.quantity % 1 ? 2 : 0)}</td>
                  <td className="r">{isEdit ? <input className="input num" style={{ width: 110 }} type="number" value={draft.avgPrice} onChange={(e) => setDraft({ ...draft, avgPrice: e.target.value })} aria-label="Average price" /> : fmt.money(h.avgPrice, p?.currency ?? base)}</td>
                  <td className="r">{p ? fmt.money(p.price, p.currency) : "…"}</td>
                  <td className="r">{p ? fmt.money(p.value, base, 0) : "…"}</td>
                  <td className={`r ${tone(p?.pnl)}`}>{p ? <>{fmt.money(p.pnl, base, 0)}<div className="small">{fmt.pct(p.pnlPct)}</div></> : "…"}</td>
                  <td className="r">{p ? fmt.pctAbs(p.weight, 1) : "…"}</td>
                  <td className="r" style={{ whiteSpace: "nowrap" }}>
                    {isEdit ? (
                      <><button className="btn sm primary" onClick={() => saveEdit(id)}>Save</button> <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button></>
                    ) : (
                      <><button className="btn sm ghost" onClick={() => { setEditing(id); setDraft({ quantity: h.quantity, avgPrice: h.avgPrice }); }}>Edit</button> <button className="btn sm ghost" onClick={() => remove(id)}>Remove</button></>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WhatIf({ holdings, range, horizon, setHorizon, base }) {
  const [symbol, setSymbol] = useState(holdings[0]?.symbol ?? "");
  const [amount, setAmount] = useState("10000");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      setResult(await runJob("myportfolio", { range, days: HORIZONS[horizon], add: { symbol, amount: Number(amount) } }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const cur = result?.base ?? base;
  const money = (v) => fmt.money(v, cur, 0);
  const w = result?.whatIf;
  const hasNow = !!result?.forecast;
  const rows = w && [
    ["Value today", hasNow ? money(result.summary.value) : "–", money(w.after.value), money(w.amount)],
    [`Most likely in ${HORIZON_WORDS[horizon]}`, hasNow ? money(result.forecast.median) : "–", money(w.after.forecast.median), money(w.alone.forecast.median)],
    ["Bad case (5%)", hasNow ? money(result.forecast.p5) : "–", money(w.after.forecast.p5), money(w.alone.forecast.p5)],
    ["Good case (95%)", hasNow ? money(result.forecast.p95) : "–", money(w.after.forecast.p95), money(w.alone.forecast.p95)],
    ["Chance of profit", hasNow ? fmt.pctAbs(result.forecast.probProfit, 0) : "–", fmt.pctAbs(w.after.forecast.probProfit, 0), fmt.pctAbs(w.alone.forecast.probProfit, 0)],
    ["Chance of losing over 10%", hasNow ? fmt.pctAbs(result.forecast.probLoss10, 0) : "–", fmt.pctAbs(w.after.forecast.probLoss10, 0), fmt.pctAbs(w.alone.forecast.probLoss10, 0)],
    ["Annual volatility", hasNow ? fmt.pctAbs(result.risk.annualVol) : "–", fmt.pctAbs(w.after.risk.annualVol), fmt.pctAbs(w.alone.risk.annualVol)],
    ["Sharpe ratio", hasNow ? fmt.num(result.risk.sharpe) : "–", fmt.num(w.after.risk.sharpe), fmt.num(w.alone.risk.sharpe)],
    ["1-day VaR (95%)", hasNow ? money(result.risk.var95Money) : "–", money(w.after.risk.var95Money), money(w.alone.risk.var95Money)],
    ["Behaves like N equal stocks", hasNow ? fmt.num(result.risk.effectiveHoldings, 1) : "–", fmt.num(w.after.risk.effectiveHoldings, 1), "1.0"],
  ];
  const volChange = w && hasNow ? w.after.risk.annualVol - result.risk.annualVol : null;
  const corr = w?.corrWithPortfolio;
  const corrWord = corr == null ? null : corr < 0.3 ? "low, so it diversifies your portfolio well" : corr < 0.6 ? "moderate, so it diversifies somewhat" : "high, so it adds little diversification";

  return (
    <section className="panel stack" style={{ "--gap": "16px", borderColor: "color-mix(in srgb, var(--amber) 40%, transparent)" }}>
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="h3">What if I invest more?</h2>
          <p className="muted small">Pick a stock and an amount to see, before you invest, how it changes your portfolio’s likely value and risk. 1,000 simulated futures; not a guarantee.</p>
        </div>
        <Seg label="Horizon" value={horizon} options={Object.keys(HORIZONS)} onChange={setHorizon} />
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <label className="field">Stock
          <div className="row" style={{ gap: 6 }}>
            {holdings.slice(0, 5).map((h) => <button key={h.symbol} className="chip" aria-pressed={symbol === h.symbol} onClick={() => setSymbol(h.symbol)}>{h.symbol}</button>)}
            {symbol && !holdings.some((h) => h.symbol === symbol) && <span className="chip" aria-pressed="true">{symbol}</span>}
            <div style={{ width: 200 }}><SymbolSearch placeholder="Or a new stock" onPick={setSymbol} /></div>
          </div>
        </label>
        <label className="field">Amount ({holdings.length ? base : "in the stock’s currency"})<input className="input" style={{ width: 150 }} type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
        <button className="btn primary" disabled={!symbol || !(amount > 0) || busy} onClick={run}>{busy ? "Simulating…" : "Simulate"}</button>
      </div>
      <ErrorNote error={error} />
      {w && (
        <>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            Investing <b>{money(w.amount)}</b> in <b>{w.symbol}</b> buys about <b>{fmt.num(w.shares, 2)} shares</b> at {fmt.money(w.price, w.currency)}.
            {" "}In {HORIZON_WORDS[horizon]}, your portfolio would most likely be worth <b>{money(w.after.forecast.median)}</b> (90% range {money(w.after.forecast.p5)} to {money(w.after.forecast.p95)}).
            {volChange != null && <> Risk {volChange < 0 ? "goes down" : "goes up"} from {fmt.pctAbs(result.risk.annualVol)} to {fmt.pctAbs(w.after.risk.annualVol)} annual volatility.</>}
            {corrWord && <> Its correlation with your portfolio is {fmt.num(corr)}: {corrWord}.</>}
          </p>
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Measure</th><th className="r">Portfolio now</th><th className="r" style={{ color: C.amber }}>After adding</th><th className="r">This money alone</th></tr></thead>
              <tbody>{rows.map(([label, a, b, c]) => <tr key={label}><td className="muted">{label}</td><td className="r">{a}</td><td className="r" style={{ fontWeight: 600 }}>{b}</td><td className="r">{c}</td></tr>)}</tbody>
            </table>
          </div>
          <div>
            <p className="faint small" style={{ marginBottom: 6 }}>Your portfolio after adding {money(w.amount)}: last 60 days and 1,000 simulated paths</p>
            <FanChart result={w.after.forecast} history={w.after.forecast.history} currency={cur} />
          </div>
        </>
      )}
    </section>
  );
}
