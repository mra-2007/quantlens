import { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis, ZAxis, Tooltip, CartesianGrid, LabelList } from "recharts";
import { runJob } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmt, C } from "../lib/format";
import Heatmap from "../components/Heatmap";
import { SymbolSearch, ErrorNote, SimNote, Seg, ProGate, Skeleton } from "../components/ui";

// Fixed-size markers so the two optimal portfolios stand out from the sampled cloud.
const StarMark = ({ cx, cy }) => {
  const pts = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 4.5 : 11;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(" ");
  return <polygon points={pts} fill={C.amber} stroke={C.ink} strokeWidth={1.5} />;
};
const DiamondMark = ({ cx, cy }) => <polygon points={`${cx},${cy - 9} ${cx + 9},${cy} ${cx},${cy + 9} ${cx - 9},${cy}`} fill={C.up} stroke={C.ink} strokeWidth={1.5} />;
const AssetMark = ({ cx, cy }) => <circle cx={cx} cy={cy} r={4} fill={C.chalk} />;

const START = ["AAPL", "MSFT", "JPM", "KO", "XOM"];

function FrontierTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="tt">
      {p.symbol && <div style={{ fontWeight: 700 }}>{p.symbol}</div>}
      {p.tag && <div className="amber" style={{ fontWeight: 700 }}>{p.tag}</div>}
      <div className="tt-row"><span className="muted">Return μ</span><b>{fmt.pct(p.ret)}</b></div>
      <div className="tt-row"><span className="muted">Volatility σ</span><b>{fmt.pctAbs(p.vol)}</b></div>
      {p.sharpe != null && <div className="tt-row"><span className="muted">Sharpe</span><b>{fmt.num(p.sharpe)}</b></div>}
    </div>
  );
}

export default function Portfolio() {
  const { isPro } = useAuth();
  const [symbols, setSymbols] = useState(START);
  const [range, setRange] = useState("2y");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [pick, setPick] = useState("Max Sharpe");

  useEffect(() => {
    document.title = "Portfolio / QuantLens";
    if (!isPro || symbols.length < 2) return;
    const ctl = new AbortController();
    // Debounced so the frontier re-plots live as you add or remove stocks.
    const t = setTimeout(() => {
      setBusy(true);
      setError(null);
      runJob("frontier", { symbols, range, samples: 4000 }, { signal: ctl.signal })
        .then(setResult)
        .catch((e) => e.name !== "AbortError" && setError(e))
        .finally(() => setBusy(false));
    }, 350);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [symbols, range, isPro]);

  if (!isPro) {
    return (
      <ProGate title="Build a portfolio on the efficient frontier">
        Choose up to 10 stocks and QuantLens samples thousands of weightings to plot the Markowitz frontier, then shows the mix with the best risk-adjusted return.
      </ProGate>
    );
  }

  const chosen = result ? (pick === "Max Sharpe" ? result.maxSharpe : result.minVol) : null;
  // Capital market line from r_f through the max-Sharpe portfolio.
  const cml = result ? [{ vol: 0, ret: result.riskFree }, { vol: result.maxSharpe.vol * 1.6, ret: result.riskFree + result.maxSharpe.sharpe * result.maxSharpe.vol * 1.6 }] : [];

  return (
    <div className="stack" style={{ "--gap": "20px" }}>
      <div className="page-head">
        <div>
          <h1>Portfolio builder</h1>
          <p className="muted">Long-only Markowitz optimisation. The frontier redraws as you change the stocks.</p>
        </div>
        <Seg label="Range" value={range} options={["1y", "2y", "5y"]} onChange={setRange} />
      </div>

      <div className="panel row">
        {symbols.map((s) => (
          <button key={s} className="chip" aria-pressed="true" onClick={() => setSymbols(symbols.filter((x) => x !== s))} aria-label={`Remove ${s}`}>
            {s} <span aria-hidden="true">×</span>
          </button>
        ))}
        {symbols.length < 10 && (
          <div style={{ width: 240 }}>
            <SymbolSearch placeholder="Add a stock" onPick={(s) => !symbols.includes(s) && setSymbols([...symbols, s])} />
          </div>
        )}
        {busy && <span className="faint small">Sampling 4,000 portfolios…</span>}
      </div>

      <ErrorNote error={error} />
      {symbols.length < 2 && <p className="muted">Add at least two stocks to see a frontier.</p>}
      {!result && !error && symbols.length >= 2 && <Skeleton h={460} />}

      {result && (
        <>
          <SimNote show={result.simulated} />
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}>
            <section className="panel" style={{ gridColumn: "span 2", minWidth: 0, opacity: busy ? 0.6 : 1, transition: "opacity .2s" }}>
              <div className="panel-head">
                <h2 className="h3">Efficient frontier</h2>
                <span className="faint small">Annualised, r<sub>f</sub> = {fmt.pctAbs(result.riskFree)}</span>
              </div>
              <ResponsiveContainer width="100%" height={420}>
                <ComposedChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
                  <CartesianGrid stroke={C.rule} strokeDasharray="2 4" />
                  <XAxis type="number" dataKey="vol" name="Volatility" tickFormatter={(v) => fmt.pctAbs(v, 0)} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} domain={[0, "auto"]} label={{ value: "Volatility σ", position: "insideBottomRight", offset: -4, fill: C.muted, fontSize: 12 }} />
                  <YAxis type="number" dataKey="ret" name="Return" tickFormatter={(v) => fmt.pct(v, 0)} tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={52} domain={["auto", "auto"]} />
                  <ZAxis range={[10, 10]} />
                  <Tooltip content={<FrontierTip />} cursor={{ strokeDasharray: "3 3", stroke: C.rule }} />
                  <Scatter data={result.cloud} fill={C.sky} fillOpacity={0.22} isAnimationActive={false} shape="circle" />
                  <Line data={cml} dataKey="ret" stroke={C.muted} strokeDasharray="4 4" dot={false} isAnimationActive={false} legendType="none" activeDot={false} />
                  <Line data={result.frontier} dataKey="ret" stroke={C.amber} strokeWidth={2.5} dot={false} isAnimationActive={false} activeDot={false} />
                  <Scatter data={result.assets} fill={C.chalk} shape={AssetMark} isAnimationActive={false}>
                    <LabelList dataKey="symbol" position="right" fill={C.chalk} fontSize={12} fontWeight={700} />
                  </Scatter>
                  <Scatter data={[{ ...result.maxSharpe, tag: "Max Sharpe" }]} shape={StarMark} isAnimationActive={false} />
                  <Scatter data={[{ ...result.minVol, tag: "Min volatility" }]} shape={DiamondMark} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              <div className="row small muted" style={{ gap: 18 }}>
                <span><span className="amber">★</span> Max Sharpe</span>
                <span><span className="up">◆</span> Min volatility</span>
                <span><span style={{ color: C.amber }}>━</span> Frontier</span>
                <span>┄ Capital market line</span>
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2 className="h3">Weights</h2>
                <Seg label="Portfolio" value={pick} options={["Max Sharpe", "Min volatility"]} onChange={setPick} />
              </div>
              <div className="stack" style={{ "--gap": "10px" }}>
                {result.symbols.map((s, i) => ({ s, w: chosen.weights[i] })).sort((a, b) => b.w - a.w).map(({ s, w }) => (
                  <div key={s}>
                    <div className="spread small"><b>{s}</b><span>{fmt.pctAbs(w, 1)}</span></div>
                    <div style={{ height: 6, background: C.rule, borderRadius: 3, marginTop: 4 }}>
                      <div style={{ width: `${w * 100}%`, height: "100%", background: pick === "Max Sharpe" ? C.amber : C.up, borderRadius: 3, transition: "width .3s" }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="metrics" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 20 }}>
                <div className="metric"><div className="label">Return</div><div className="value" style={{ fontSize: 19 }}>{fmt.pct(chosen.ret)}</div></div>
                <div className="metric"><div className="label">Volatility</div><div className="value" style={{ fontSize: 19 }}>{fmt.pctAbs(chosen.vol)}</div></div>
                <div className="metric"><div className="label">Sharpe</div><div className="value" style={{ fontSize: 19 }}>{fmt.num(chosen.sharpe)}</div></div>
              </div>
              <p className="math small faint" style={{ marginTop: 12 }}>σ<sub>p</sub> = √(wᵀΣw), μ<sub>p</sub> = wᵀμ, Σw = 1, w ≥ 0</p>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head"><h2 className="h3">Correlation</h2><span className="faint small">Lower correlation means more diversification</span></div>
            <Heatmap symbols={result.correlation.symbols} matrix={result.correlation.matrix} />
          </section>
        </>
      )}
    </div>
  );
}
