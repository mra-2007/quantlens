import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { api, runJob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, tone, C } from "../lib/format";
import PriceChart, { OVERLAYS } from "../components/PriceChart";
import FanChart from "../components/FanChart";
import { Metric, ErrorNote, SimNote, Seg, ChartTip, Skeleton } from "../components/ui";

const RANGE_OPTS = ["6mo", "1y", "2y", "5y"];
const HORIZONS = { "1M": 21, "6M": 126, "1Y": 252 };

export default function Stock() {
  const { symbol: raw } = useParams();
  const symbol = decodeURIComponent(raw).toUpperCase();
  const { user, isPro } = useAuth();
  const [range, setRange] = useState("1y");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [overlays, setOverlays] = useState(["sma50", "sma200", "bb"]);
  const [osc, setOsc] = useState("RSI");

  useEffect(() => {
    const ctl = new AbortController();
    setError(null);
    setData(null);
    api(`/stocks/${encodeURIComponent(symbol)}/analysis?range=${range}`, { signal: ctl.signal })
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
  }, [symbol, range]);

  useEffect(() => {
    document.title = `${symbol} / QuantLens`;
  }, [symbol]);

  const toggle = (k) => setOverlays((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));

  if (error) {
    return (
      <div className="stack">
        <h1 className="h2">{symbol}</h1>
        <ErrorNote error={error} />
        <p className="muted">Check the ticker. Indian stocks need an exchange suffix, such as RELIANCE.NS for NSE.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="stack">
        <Skeleton h={70} />
        <Skeleton h={560} />
        <Skeleton h={220} />
      </div>
    );
  }

  const q = data.quote;
  const r = data.risk;
  const cur = data.currency;

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="quote-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 className="h2">{data.name}</h1>
            <span className="badge">{symbol}</span>
          </div>
          <div className="row" style={{ marginTop: 12, alignItems: "baseline", gap: 14 }}>
            <span className="px">{fmt.money(q.price, cur)}</span>
            <span className={tone(q.change)} style={{ fontWeight: 600, fontSize: 17 }}>
              {q.change >= 0 ? "+" : ""}{fmt.num(q.change)} ({fmt.pct(q.changePct, 2)})
            </span>
            <span className="faint small">Close {q.asOf}</span>
          </div>
        </div>
        <div className="row">
          <Seg label="History range" value={range} options={RANGE_OPTS} onChange={setRange} />
          <WatchButton symbol={symbol} user={user} />
        </div>
      </div>

      <SimNote show={data.simulated} />

      <section className="panel flush">
        <div className="legend-row spread">
          <div className="row" style={{ gap: 6 }}>
            {OVERLAYS.map((o) => (
              <button key={o.key} className="chip" aria-pressed={overlays.includes(o.key)} onClick={() => toggle(o.key)} style={overlays.includes(o.key) ? { color: o.color } : undefined}>
                <span className="dot" style={{ background: o.color }} />{o.label}
              </button>
            ))}
          </div>
          <Seg label="Oscillator" value={osc} options={["RSI", "MACD", "Stochastic"]} onChange={setOsc} />
        </div>
        <PriceChart data={data} overlays={overlays} oscillator={osc} />
      </section>

      <section>
        <div className="panel-head">
          <h2 className="h3">Risk</h2>
          <span className="faint small">Daily returns, {data.candles.length} sessions, r<sub>f</sub> = {fmt.pctAbs(r.riskFree, 1)}</span>
        </div>
        <div className="metrics">
          <Metric label="Annual volatility" value={fmt.pctAbs(r.annualVol)} formula="σ_daily · √252" />
          <Metric label="Sharpe ratio" value={fmt.num(r.sharpe)} tone={tone(r.sharpe)} formula="(252μ − r_f) / (σ√252)" />
          <Metric label="Sortino ratio" value={fmt.num(r.sortino)} formula="(252μ − r_f) / σ_down√252" />
          <Metric label="Maximum drawdown" value={fmt.pct(r.maxDrawdown)} tone="down" formula={`${r.drawdownFrom} → ${r.drawdownTo}`} />
          <Metric label="1-day VaR (95%)" value={fmt.pctAbs(r.var95.historical, 2)} formula="−q₀.₀₅(r), historical" hint={`Parametric: ${fmt.pctAbs(r.var95.parametric, 2)}`} />
          <Metric label="Expected shortfall (95%)" value={fmt.pctAbs(r.var95.expectedShortfall, 2)} formula="−E[r | r ≤ q₀.₀₅]" />
          <Metric label={`Beta vs ${data.index}`} value={r.beta ? fmt.num(r.beta.beta) : "–"} formula="cov(r, r_m) / var(r_m)" />
          <Metric label="Return over range" value={fmt.pct(r.totalReturn)} tone={tone(r.totalReturn)} formula={`CAGR ${fmt.pct(r.cagr)}`} />
        </div>
      </section>

      <div className="grid g2">
        <section className="panel">
          <div className="panel-head"><h2 className="h3">Drawdown</h2><span className="faint small">P / running peak − 1</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.candles.map((c, i) => ({ t: c.time, dd: r.drawdownSeries[i] }))} margin={{ left: 0, right: 8, top: 4 }}>
              <XAxis dataKey="t" hide />
              <YAxis tickFormatter={(v) => fmt.pctAbs(v, 0)} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={48} />
              <Tooltip content={<ChartTip format={(v) => fmt.pct(v)} />} />
              <Area dataKey="dd" name="Drawdown" stroke={C.down} fill={C.down} fillOpacity={0.18} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
        <section className="panel">
          <div className="panel-head"><h2 className="h3">Latest readings</h2><span className="faint small">Rule-based, not advice</span></div>
          <div className="signal-list">
            {data.signals.map((s) => (
              <div key={s.name}>
                <span className="muted">{s.name}</span>
                <span><b>{fmt.num(s.value, 2)}</b> <span className={`badge ${/bull|oversold|below/.test(s.state) ? "up" : /bear|overbought|above/.test(s.state) ? "down" : ""}`}>{s.state}</span></span>
              </div>
            ))}
            <div>
              <span className="muted">Regression trend</span>
              <span><span className="math">b</span> = <b>{fmt.num(data.trend.slopePerDay, 3)}</b>/day, <span className="math">R²</span> = <b>{fmt.num(data.trend.r2, 2)}</b></span>
            </div>
            <div>
              <span className="muted">Trend in 30 sessions</span>
              <b>{fmt.money(data.trend.projection.at(-1).value, cur)} ± {fmt.num(2 * data.trend.residualSd, 2)}</b>
            </div>
          </div>
        </section>
      </div>

      <MonteCarlo symbol={symbol} candles={data.candles} currency={cur} />

      {user && <AlertQuick symbol={symbol} price={q.price} isPro={isPro} />}
    </div>
  );
}

function MonteCarlo({ symbol, candles, currency }) {
  const [horizon, setHorizon] = useState("6M");
  const [result, setResult] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctl = new AbortController();
    setResult(null);
    setError(null);
    runJob("montecarlo", { symbol, days: HORIZONS[horizon], paths: 1000, range: "2y" }, { onState: setState, signal: ctl.signal })
      .then(setResult)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
  }, [symbol, horizon]);

  const hist = useMemo(() => {
    if (!result) return [];
    return result.terminal.histogram.map((b) => ({ mid: (b.from + b.to) / 2, count: b.count, above: (b.from + b.to) / 2 >= result.s0 }));
  }, [result]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2 className="h3">Monte Carlo forecast</h2>
          <p className="muted small">1,000 simulated paths of geometric Brownian motion, calibrated on two years of log returns.</p>
        </div>
        <Seg label="Horizon" value={horizon} options={Object.keys(HORIZONS)} onChange={setHorizon} />
      </div>
      <ErrorNote error={error} />
      {!result && !error && (
        <div className="stack">
          <p className="faint small">{state === "active" ? "Simulating 1,000 paths…" : "Queued…"}</p>
          <Skeleton h={340} />
        </div>
      )}
      {result && (
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", alignItems: "start" }}>
          <div style={{ gridColumn: "span 2", minWidth: 0 }}>
            <FanChart result={result} history={candles} currency={currency} />
          </div>
          <div className="stack" style={{ "--gap": "14px" }}>
            <div className="metrics" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Metric label="Median" value={fmt.money(result.terminal.p50, currency, 0)} />
              <Metric label="Chance above today" value={fmt.pctAbs(result.terminal.probAbove, 0)} />
              <Metric label="5th percentile" value={fmt.money(result.terminal.p5, currency, 0)} tone="down" />
              <Metric label="95th percentile" value={fmt.money(result.terminal.p95, currency, 0)} tone="up" />
            </div>
            <div>
              <div className="faint small" style={{ marginBottom: 6 }}>Ending prices after {result.days} sessions</div>
              <ResponsiveContainer width="100%" height={130}>
                <BarChart data={hist} margin={{ left: 0, right: 0, top: 0, bottom: 0 }} barCategoryGap={1}>
                  <XAxis dataKey="mid" hide />
                  <Tooltip content={<ChartTip labelFormat={(l) => `≈ ${fmt.money(l, currency, 0)}`} format={(v) => `${v} paths`} />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                  <ReferenceLine x={hist.find((h) => h.above)?.mid} stroke={C.chalk} strokeDasharray="2 3" />
                  <Bar dataKey="count" name="Paths" isAnimationActive={false}>
                    {hist.map((h, i) => <Cell key={i} fill={h.above ? C.up : C.down} fillOpacity={0.7} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="math small muted">μ = {fmt.num(result.drift * 100, 3)}%/day, σ = {fmt.num(result.sigma * 100, 2)}%/day</p>
          </div>
        </div>
      )}
    </section>
  );
}

function WatchButton({ symbol, user }) {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!user) return;
    api("/watchlist").then((d) => setOn(d.items.some((i) => i.symbol === symbol))).catch(() => {});
  }, [symbol, user]);
  if (!user) return <Link to="/signup" className="btn">Add to watchlist</Link>;
  const click = async () => {
    setMsg(null);
    try {
      if (on) await api(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" });
      else await api("/watchlist", { method: "POST", body: { symbol } });
      setOn(!on);
    } catch (e) {
      setMsg(e.message);
    }
  };
  return (
    <>
      <button className={`btn ${on ? "" : "primary"}`} onClick={click} aria-pressed={on}>{on ? "On your watchlist" : "Add to watchlist"}</button>
      {msg && <span className="small down" role="alert" style={{ flexBasis: "100%", textAlign: "right" }}>{msg}</span>}
    </>
  );
}

function AlertQuick({ symbol, price, isPro }) {
  const [direction, setDirection] = useState("above");
  const [target, setTarget] = useState(() => (price * 1.05).toFixed(2));
  const [done, setDone] = useState(null);
  const [error, setError] = useState(null);
  const create = async () => {
    setError(null);
    try {
      await api("/alerts", { method: "POST", body: { symbol, direction, target: Number(target) } });
      setDone(`We'll email you when ${symbol} goes ${direction} ${target}.`);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div className="row"><h2 className="h3">Price alert</h2>{!isPro && <span className="badge pro">Pro</span>}</div>
      </div>
      {isPro ? (
        <div className="row">
          <span className="muted">Email me when {symbol} goes</span>
          <select className="select" value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Direction">
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
          <input className="input num" style={{ width: 120 }} type="number" step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target price" />
          <button className="btn primary" onClick={create}>Create alert</button>
          {done && <span className="up small">{done}</span>}
          <ErrorNote error={error} />
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Price-alert emails are part of Pro. <Link to="/dashboard#plan">See plans</Link></p>
      )}
    </section>
  );
}
