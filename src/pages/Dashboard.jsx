import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, YAxis } from "recharts";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, tone, C } from "../lib/format";
import { ErrorNote, SymbolSearch, Skeleton } from "../components/ui";

function WatchRow({ symbol, onRemove }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    api(`/stocks/${encodeURIComponent(symbol)}/history?range=6mo`).then(setD).catch(() => setD({ error: true }));
  }, [symbol]);
  const c = d?.candles;
  const last = c?.at(-1)?.close;
  const chg = c ? last / c.at(-2).close - 1 : null;
  const six = c ? last / c[0].close - 1 : null;
  return (
    <tr>
      <td><Link to={`/s/${symbol}`} style={{ fontWeight: 700, textDecoration: "none" }}>{symbol}</Link><div className="faint small">{d?.name}</div></td>
      <td style={{ width: 140 }}>
        {c && (
          <ResponsiveContainer width="100%" height={36}>
            <LineChart data={c.slice(-60)}>
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Line dataKey="close" stroke={six >= 0 ? C.up : C.down} dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </td>
      <td className="r">{d?.error ? <span className="faint">unavailable</span> : fmt.money(last, d?.currency)}</td>
      <td className={`r ${tone(chg)}`}>{fmt.pct(chg, 2)}</td>
      <td className={`r ${tone(six)}`}>{fmt.pct(six)}</td>
      <td className="r"><button className="btn sm ghost" onClick={() => onRemove(symbol)}>Remove</button></td>
    </tr>
  );
}

export default function Dashboard() {
  const { user, ready, isPro, upgrade, billing } = useAuth();
  const [payErr, setPayErr] = useState(null);
  const navigate = useNavigate();
  const [watch, setWatch] = useState(null);
  const [strategies, setStrategies] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.title = "Dashboard / QuantLens";
    if (!user) return;
    api("/watchlist").then(setWatch).catch(setError);
    if (isPro) {
      api("/strategies").then((d) => setStrategies(d.strategies)).catch(setError);
      api("/alerts").then((d) => setAlerts(d.alerts)).catch(setError);
    }
  }, [user, isPro]);

  if (!ready) return <Skeleton h={300} />;
  if (!user) return <Navigate to="/login" replace />;

  const addWatch = async (symbol) => {
    setError(null);
    try { setWatch({ ...watch, ...(await api("/watchlist", { method: "POST", body: { symbol } })) }); } catch (e) { setError(e); }
  };
  const removeWatch = async (symbol) => setWatch({ ...watch, ...(await api(`/watchlist/${encodeURIComponent(symbol)}`, { method: "DELETE" })) });

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>{user.name ? `Hello, ${user.name.split(" ")[0]}` : "Your dashboard"}</h1>
          <p className="muted">{user.email}</p>
        </div>
        <span className={`badge ${isPro ? "pro" : ""}`}>{isPro ? "Pro plan" : "Free plan"}</span>
      </div>
      <ErrorNote error={error} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2 className="h3">Watchlist</h2>
            {watch?.limit && <p className="faint small">{watch.items.length} of {watch.limit} on the free plan</p>}
          </div>
          <div style={{ width: 240 }}><SymbolSearch placeholder="Add to watchlist" onPick={addWatch} /></div>
        </div>
        {!watch ? <Skeleton h={120} /> : watch.items.length === 0 ? (
          <p className="muted">Your watchlist is empty. Search for a stock above to start tracking it.</p>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead><tr><th>Stock</th><th>60 days</th><th className="r">Last</th><th className="r">Day</th><th className="r">6 months</th><th /></tr></thead>
              <tbody>{watch.items.map((i) => <WatchRow key={i.symbol} symbol={i.symbol} onRemove={removeWatch} />)}</tbody>
            </table>
          </div>
        )}
      </section>

      {isPro ? (
        <div className="grid g2">
          <section className="panel">
            <div className="panel-head"><h2 className="h3">Saved strategies</h2><Link className="btn sm" to="/backtest">New backtest</Link></div>
            {strategies.length === 0 ? <p className="muted">Strategies you save from the backtester appear here.</p> : (
              <table className="table">
                <tbody>
                  {strategies.map((s) => (
                    <tr key={s.id}>
                      <td><b>{s.name}</b><div className="faint small">{s.symbol}</div></td>
                      <td className={`r ${tone(s.lastResult?.stats?.strategy?.totalReturn)}`}>{fmt.pct(s.lastResult?.stats?.strategy?.totalReturn)}</td>
                      <td className="r">
                        <button className="btn sm" onClick={() => navigate("/backtest", { state: { config: s.config, symbol: s.symbol } })}>Open</button>
                        <button className="btn sm ghost" onClick={async () => { await api(`/strategies/${s.id}`, { method: "DELETE" }); setStrategies(strategies.filter((x) => x.id !== s.id)); }}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <div className="panel-head"><h2 className="h3">Price alerts</h2><span className="faint small">Checked automatically</span></div>
            {alerts.length === 0 ? <p className="muted">Create an alert from any stock page and we'll email you when it hits your price.</p> : (
              <table className="table">
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td><b>{a.symbol}</b> <span className="muted">{a.direction}</span> {fmt.num(a.target)}</td>
                      <td>{a.active ? <span className="badge">watching</span> : <span className="badge up">sent at {fmt.num(a.triggeredPrice)}</span>}</td>
                      <td className="r"><button className="btn sm ghost" onClick={async () => { await api(`/alerts/${a.id}`, { method: "DELETE" }); setAlerts(alerts.filter((x) => x.id !== a.id)); }}>Delete</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : null}

      <section className="panel" id="plan">
        <div className="spread">
          <div>
            <h2 className="h3">{isPro ? "You're on Pro" : "Upgrade to Pro"}</h2>
            <p className="muted" style={{ margin: "6px 0 0", maxWidth: "60ch" }}>
              {isPro ? "Backtesting, the portfolio optimiser, saved strategies, price-alert emails and an unlimited watchlist are switched on." : "Unlock the backtester, the portfolio optimiser, saved strategies, price-alert emails and an unlimited watchlist."}
            </p>
          </div>
          <button className={`btn ${isPro ? "" : "primary"}`} onClick={() => { setPayErr(null); upgrade(isPro ? "free" : "pro").catch(setPayErr); }}>
            {isPro ? "Switch to Free" : billing.provider === "razorpay" ? "Upgrade for ₹399/month" : "Upgrade to Pro"}
          </button>
        </div>
        <ErrorNote error={payErr} />
        <p className="faint small" style={{ marginBottom: 0 }}>
          {billing.provider === "razorpay" ? (billing.testMode ? "Payments run in Razorpay test mode; no money is charged." : "Payments are processed securely by Razorpay.") : "Demo mode: plan changes are instant and free because payments aren't configured."}
        </p>
      </section>
    </div>
  );
}
