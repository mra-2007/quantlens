import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine } from "recharts";
import { api } from "../lib/api";
import { fmt, tone, C } from "../lib/format";
import Heatmap from "../components/Heatmap";
import { SymbolSearch, ErrorNote, SimNote, Seg, ChartTip, Skeleton } from "../components/ui";

const DEFAULT = ["AAPL", "MSFT", "NVDA", "KO"];

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const symbols = (params.get("s") ?? DEFAULT.join(",")).split(",").filter(Boolean).slice(0, 5);
  const [range, setRange] = useState("1y");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const key = symbols.join(",");

  useEffect(() => {
    document.title = "Compare / QuantLens";
    if (symbols.length < 2) { setData(null); return; }
    const ctl = new AbortController();
    setError(null);
    api(`/compare?symbols=${encodeURIComponent(key)}&range=${range}`, { signal: ctl.signal })
      .then(setData)
      .catch((e) => e.name !== "AbortError" && setError(e));
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range]);

  const setSymbols = (list) => setParams({ s: list.join(",") });

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>Compare stocks</h1>
          <p className="muted">How 2 to 5 stocks move together, and how much risk each one carries.</p>
        </div>
        <Seg label="Range" value={range} options={["6mo", "1y", "2y", "5y"]} onChange={setRange} />
      </div>

      <div className="panel row">
        {symbols.map((s, i) => (
          <button key={s} className="chip" aria-pressed="true" style={{ color: C.series[i] }} onClick={() => setSymbols(symbols.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
            <span className="dot" style={{ background: C.series[i] }} />{s} <span aria-hidden="true">×</span>
          </button>
        ))}
        {symbols.length < 5 ? (
          <div style={{ width: 260 }}>
            <SymbolSearch placeholder="Add a stock" onPick={(s) => !symbols.includes(s) && setSymbols([...symbols, s])} />
          </div>
        ) : (
          <span className="faint small">Five is the maximum. Remove one to add another.</span>
        )}
      </div>

      <ErrorNote error={error} />
      {symbols.length < 2 && <p className="muted">Add at least two stocks to compare.</p>}
      {data && <SimNote show={data.simulated} />}
      {!data && !error && symbols.length >= 2 && <Skeleton h={420} />}

      {data && (
        <>
          <div className="grid g2">
            <section className="panel">
              <div className="panel-head"><h2 className="h3">Correlation</h2><span className="faint small">{data.observations} shared sessions</span></div>
              <Heatmap symbols={data.correlation.symbols} matrix={data.correlation.matrix} />
            </section>
            <section className="panel">
              <div className="panel-head"><h2 className="h3">Growth of 1</h2><span className="faint small">P<sub>t</sub> / P<sub>0</sub> − 1</span></div>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.performance} margin={{ left: 0, right: 8, top: 4 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} minTickGap={50} tickFormatter={(t) => t.slice(0, 7)} />
                  <YAxis tickFormatter={(v) => fmt.pct(v, 0)} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={52} />
                  <ReferenceLine y={0} stroke={C.rule} />
                  <Tooltip content={<ChartTip format={(v) => fmt.pct(v)} />} />
                  {data.symbols.map((s, i) => <Line key={s} dataKey={s} name={s} stroke={C.series[i]} dot={false} strokeWidth={1.75} isAnimationActive={false} />)}
                </LineChart>
              </ResponsiveContainer>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head"><h2 className="h3">Risk side by side</h2><span className="faint small">Beta measured against {data.index}</span></div>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr><th>Stock</th><th className="r">Return</th><th className="r">Volatility <span className="math">σ√252</span></th><th className="r">Sharpe</th><th className="r">Max drawdown</th><th className="r">Beta <span className="math">β</span></th></tr>
                </thead>
                <tbody>
                  {data.metrics.map((m, i) => (
                    <tr key={m.symbol}>
                      <td><Link to={`/s/${m.symbol}`} style={{ color: C.series[i], fontWeight: 700, textDecoration: "none" }}>{m.symbol}</Link> <span className="faint small">{m.name}</span></td>
                      <td className={`r ${tone(m.totalReturn)}`}>{fmt.pct(m.totalReturn)}</td>
                      <td className="r">{fmt.pctAbs(m.annualVol)}</td>
                      <td className={`r ${tone(m.sharpe)}`}>{fmt.num(m.sharpe)}</td>
                      <td className="r down">{fmt.pct(m.maxDrawdown)}</td>
                      <td className="r">{fmt.num(m.beta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
