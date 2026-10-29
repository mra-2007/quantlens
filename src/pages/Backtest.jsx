import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api, runJob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, tone, C } from "../lib/format";
import { SymbolSearch, ErrorNote, SimNote, Seg, ChartTip, ProGate, Metric } from "../components/ui";

const IND = {
  price: { label: "Price", period: false },
  sma: { label: "SMA", period: 50 },
  ema: { label: "EMA", period: 20 },
  rsi: { label: "RSI", period: 14 },
  macd: { label: "MACD line", period: false },
  macdSignal: { label: "MACD signal", period: false },
  macdHist: { label: "MACD histogram", period: false },
  bbUpper: { label: "Bollinger upper", period: 20 },
  bbMiddle: { label: "Bollinger middle", period: 20 },
  bbLower: { label: "Bollinger lower", period: 20 },
  stochK: { label: "Stochastic %K", period: 14 },
  stochD: { label: "Stochastic %D", period: 14 },
};
const OPS = { crossesAbove: "crosses above", crossesBelow: "crosses below", ">": "is above", "<": "is below" };

const clone = (x) => JSON.parse(JSON.stringify(x));
const blankRule = () => ({ left: { ind: "rsi", period: 14 }, op: "<", right: 30 });

function OperandPicker({ value, onChange, allowNumber }) {
  const isNum = typeof value === "number";
  return (
    <>
      <select
        className="select"
        aria-label="Indicator"
        value={isNum ? "__num" : value.ind}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__num") onChange(50);
          else onChange(IND[v].period ? { ind: v, period: IND[v].period } : { ind: v });
        }}
      >
        {allowNumber && <option value="__num">Number</option>}
        {Object.entries(IND).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      {isNum ? (
        <input className="input num" type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Value" />
      ) : IND[value.ind].period ? (
        <input className="input num" type="number" min={2} max={400} value={value.period} onChange={(e) => onChange({ ...value, period: Number(e.target.value) })} aria-label="Period" title="Period (days)" />
      ) : null}
    </>
  );
}

function RuleList({ rules, onChange, join }) {
  const update = (i, patch) => onChange(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      {rules.map((r, i) => (
        <div className="rule" key={i}>
          {i > 0 && <span className="join">{join}</span>}
          <OperandPicker value={r.left} onChange={(left) => update(i, { left })} />
          <select className="select" value={r.op} onChange={(e) => update(i, { op: e.target.value })} aria-label="Condition">
            {Object.entries(OPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <OperandPicker value={r.right} onChange={(right) => update(i, { right })} allowNumber />
          {rules.length > 1 && <button className="btn sm ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove condition">Remove</button>}
        </div>
      ))}
      {rules.length < 5 && <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => onChange([...rules, blankRule()])}>Add condition</button>}
    </div>
  );
}

export default function Backtest() {
  const { isPro } = useAuth();
  const loc = useLocation();
  const [presets, setPresets] = useState(null);
  const [symbol, setSymbol] = useState(loc.state?.symbol ?? "AAPL");
  const [range, setRange] = useState("5y");
  const [strategy, setStrategy] = useState(loc.state?.config ?? null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    document.title = "Backtest / QuantLens";
    api("/strategies/presets").then((d) => {
      setPresets(d.presets);
      setStrategy((s) => s ?? clone(d.presets.goldenCross));
    });
  }, []);

  if (!isPro) {
    return (
      <ProGate title="Test a trading rule on years of history">
        Pick indicators and thresholds, for example "buy when the 50-day SMA crosses above the 200-day SMA", and see how it would have done against simply buying and holding.
      </ProGate>
    );
  }
  if (!strategy) return null;

  const run = async () => {
    setError(null);
    setResult(null);
    setSaved(null);
    try {
      const res = await runJob("backtest", { symbol, range, strategy: { ...strategy, name: undefined } }, { onState: setStatus });
      setResult(res);
    } catch (e) {
      setError(e);
    } finally {
      setStatus(null);
    }
  };

  const save = async () => {
    try {
      await api("/strategies", { method: "POST", body: { name: saveName || strategy.name || "My strategy", symbol, config: { ...strategy, name: undefined }, lastResult: result ? { stats: result.stats } : undefined } });
      setSaved("Saved to your dashboard.");
    } catch (e) {
      setError(e);
    }
  };

  const s = result?.stats;
  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>Strategy backtester</h1>
          <p className="muted">Signals use each day's close and trade at the next day's open, so the test never sees the future.</p>
        </div>
      </div>

      <section className="panel stack" style={{ "--gap": "18px" }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field">Stock
            <div className="row" style={{ gap: 8 }}>
              <span className="badge" style={{ height: 38, fontSize: 14, color: C.chalk }}>{symbol}</span>
              <div style={{ width: 220 }}><SymbolSearch placeholder="Change stock" onPick={setSymbol} /></div>
            </div>
          </label>
          <label className="field">History<Seg label="Range" value={range} options={["1y", "2y", "5y"]} onChange={setRange} /></label>
          <label className="field">Start from a preset
            <select className="select" value="" onChange={(e) => e.target.value && setStrategy(clone(presets[e.target.value]))}>
              <option value="">Choose…</option>
              {presets && Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
            </select>
          </label>
        </div>

        <div className="grid g2">
          <div>
            <h2 className="h3" style={{ marginBottom: 10 }}>Buy when <span className="faint small" style={{ fontWeight: 500 }}>all of these are true</span></h2>
            <RuleList rules={strategy.entry} join="AND" onChange={(entry) => setStrategy({ ...strategy, entry })} />
          </div>
          <div>
            <h2 className="h3" style={{ marginBottom: 10 }}>Sell when <span className="faint small" style={{ fontWeight: 500 }}>any of these is true</span></h2>
            <RuleList rules={strategy.exit} join="OR" onChange={(exit) => setStrategy({ ...strategy, exit })} />
          </div>
        </div>

        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field">Stop loss %
            <input className="input num" type="number" min={0} max={99} placeholder="off" value={strategy.stopLoss ? Math.round(strategy.stopLoss * 100) : ""} onChange={(e) => setStrategy({ ...strategy, stopLoss: e.target.value ? Number(e.target.value) / 100 : null })} />
          </label>
          <label className="field">Take profit %
            <input className="input num" type="number" min={0} max={400} placeholder="off" value={strategy.takeProfit ? Math.round(strategy.takeProfit * 100) : ""} onChange={(e) => setStrategy({ ...strategy, takeProfit: e.target.value ? Number(e.target.value) / 100 : null })} />
          </label>
          <label className="field">Fee per trade (bps)
            <input className="input num" type="number" min={0} max={100} value={strategy.feeBps ?? 5} onChange={(e) => setStrategy({ ...strategy, feeBps: Number(e.target.value) })} />
          </label>
          <button className="btn primary" onClick={run} disabled={!!status} style={{ marginLeft: "auto" }}>
            {status ? (status === "active" ? "Running…" : "Queued…") : "Run backtest"}
          </button>
        </div>
      </section>

      <ErrorNote error={error} />

      {result && (
        <>
          <SimNote show={result.simulated} />
          <section className="panel">
            <div className="panel-head">
              <h2 className="h3">Equity curve, {result.symbol}</h2>
              <span className="faint small">Starting with {fmt.money(result.initialCapital, result.currency, 0)}</span>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={result.curve} margin={{ left: 0, right: 8, top: 4 }}>
                <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={60} tickFormatter={(t) => t.slice(0, 7)} />
                <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={64} tickFormatter={(v) => fmt.compact(v)} />
                <Tooltip content={<ChartTip format={(v) => fmt.money(v, result.currency, 0)} />} />
                <Line dataKey="buyHold" name="Buy and hold" stroke={C.muted} dot={false} strokeWidth={1.5} isAnimationActive={false} />
                <Line dataKey="strategy" name="Strategy" stroke={C.amber} dot={false} strokeWidth={2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          <div className="metrics">
            <Metric label="Strategy return" value={fmt.pct(s.strategy.totalReturn)} tone={tone(s.strategy.totalReturn)} formula={`Buy and hold ${fmt.pct(s.buyHold.totalReturn)}`} />
            <Metric label="CAGR" value={fmt.pct(s.strategy.cagr)} tone={tone(s.strategy.cagr)} formula={`Buy and hold ${fmt.pct(s.buyHold.cagr)}`} />
            <Metric label="Sharpe ratio" value={fmt.num(s.strategy.sharpe)} formula={`Buy and hold ${fmt.num(s.buyHold.sharpe)}`} />
            <Metric label="Max drawdown" value={fmt.pct(s.strategy.maxDrawdown)} tone="down" formula={`Buy and hold ${fmt.pct(s.buyHold.maxDrawdown)}`} />
            <Metric label="Trades" value={s.trades} formula={`Win rate ${fmt.pctAbs(s.winRate, 0)}`} />
            <Metric label="Time in market" value={fmt.pctAbs(s.exposure, 0)} formula={`Avg trade ${fmt.pct(s.avgTrade)}`} />
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2 className="h3">Trades</h2>
              <div className="row">
                <input className="input" placeholder="Strategy name" value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-label="Strategy name" />
                <button className="btn" onClick={save}>Save strategy</button>
                {saved && <span className="up small">{saved}</span>}
              </div>
            </div>
            {result.trades.length === 0 && !result.openPosition ? (
              <p className="muted">The rules never triggered in this period. Try a looser threshold or a longer history.</p>
            ) : (
              <div className="scroll-x">
                <table className="table">
                  <thead><tr><th>Bought</th><th className="r">Price</th><th>Sold</th><th className="r">Price</th><th className="r">Return</th><th>Exit reason</th></tr></thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i}>
                        <td>{t.entryTime}</td><td className="r">{fmt.num(t.entryPrice)}</td>
                        <td>{t.exitTime}</td><td className="r">{fmt.num(t.exitPrice)}</td>
                        <td className={`r ${tone(t.returnPct)}`}>{fmt.pct(t.returnPct)}</td>
                        <td className="muted">{t.reason}</td>
                      </tr>
                    ))}
                    {result.openPosition && (
                      <tr>
                        <td>{result.openPosition.entryTime}</td><td className="r">{fmt.num(result.openPosition.entryPrice)}</td>
                        <td className="faint">still open</td><td className="r">{fmt.num(result.openPosition.markPrice)}</td>
                        <td className={`r ${tone(result.openPosition.returnPct)}`}>{fmt.pct(result.openPosition.returnPct)}</td>
                        <td className="muted">marked to last close</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
