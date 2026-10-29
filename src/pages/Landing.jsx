import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar, SymbolSearch } from "../components/ui";

/** The hero: a Monte Carlo fan drawing itself, path by path, from one starting price. */
function LiveFan() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf;
    let seed = 20261029;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

    const STEPS = 140;
    const PATHS = 160;
    const mu = 0.0006;
    const sigma = 0.018;
    const paths = Array.from({ length: PATHS }, () => {
      const p = [1];
      for (let t = 1; t <= STEPS; t++) p.push(p[t - 1] * Math.exp(mu - (sigma * sigma) / 2 + sigma * gauss()));
      return p;
    });
    // Historical stub drawn before "today".
    const hist = [1];
    for (let t = 1; t < 70; t++) hist.unshift(hist[0] / Math.exp(mu + sigma * 0.8 * gauss()));
    const quant = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(q * (s.length - 1))]; };
    const bands = Array.from({ length: STEPS + 1 }, (_, t) => {
      const col = paths.map((p) => p[t]);
      return [quant(col, 0.05), quant(col, 0.25), quant(col, 0.5), quant(col, 0.75), quant(col, 0.95)];
    });
    const all = [...hist, ...paths.flat()];
    const lo = Math.min(...bands.map((b) => b[0]), ...hist) * 0.97;
    const hi = Math.max(...bands.map((b) => b[4]), ...hist) * 1.03;

    let drawn = reduce ? PATHS : 0;
    void all;
    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const padB = 70;
      const x0 = w * 0.34;
      const X = (t) => x0 + (t / STEPS) * (w - x0 - 18);
      const XH = (i) => 18 + (i / (hist.length - 1)) * (x0 - 18);
      const Y = (v) => 24 + (1 - (v - lo) / (hi - lo)) * (h - 24 - padB);

      const progress = drawn / PATHS;
      // bands appear as paths accumulate
      const band = (a, b, alpha) => {
        ctx.beginPath();
        for (let t = 0; t <= STEPS; t++) ctx.lineTo(X(t), Y(bands[t][a]));
        for (let t = STEPS; t >= 0; t--) ctx.lineTo(X(t), Y(bands[t][b]));
        ctx.fillStyle = `rgba(242,181,68,${alpha * progress})`;
        ctx.fill();
      };
      band(0, 4, 0.12);
      band(1, 3, 0.2);

      ctx.lineWidth = 1;
      for (let k = 0; k < Math.floor(drawn); k++) {
        ctx.strokeStyle = k === Math.floor(drawn) - 1 && !reduce ? "rgba(230,236,245,0.85)" : "rgba(230,236,245,0.07)";
        ctx.beginPath();
        paths[k].forEach((v, t) => ctx.lineTo(X(t), Y(v)));
        ctx.stroke();
      }
      ctx.strokeStyle = "#E6ECF5";
      ctx.lineWidth = 2;
      ctx.beginPath();
      hist.forEach((v, i) => ctx.lineTo(XH(i), Y(v)));
      ctx.stroke();
      if (progress > 0.25) {
        ctx.strokeStyle = `rgba(242,181,68,${Math.min(1, (progress - 0.25) * 2)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        bands.forEach((b, t) => ctx.lineTo(X(t), Y(b[2])));
        ctx.stroke();
      }
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = "rgba(138,154,179,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, 16);
      ctx.lineTo(x0, h - padB + 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#8A9AB3";
      ctx.font = "500 12px Hanken Grotesk, sans-serif";
      ctx.fillText("today", x0 + 6, 30);
      ctx.fillText(`${Math.floor(drawn)} / ${PATHS} paths`, w - 120, 30);

      if (drawn < PATHS) {
        drawn = Math.min(PATHS, drawn + (drawn < 12 ? 0.18 : 1.4));
        raf = requestAnimationFrame(render);
      }
    };
    render();
    const onResize = () => { cancelAnimationFrame(raf); render(); };
    window.addEventListener("resize", onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  return (
    <div className="hero-fan">
      <canvas ref={ref} aria-label="Animated Monte Carlo simulation of future price paths fanning out from today's price" role="img" />
      <div className="caption">
        <span className="eq">S<sub>t+1</sub> = S<sub>t</sub> · exp(μ + σZ)</span>
        <span className="small muted">Geometric Brownian motion, 5–95% band</span>
      </div>
    </div>
  );
}

const MODULES = [
  { title: "Trend", rows: [["Simple moving average", "Σ P / n"], ["Exponential moving average", "αP + (1−α)EMA"], ["MACD", "EMA₁₂ − EMA₂₆"], ["Bollinger Bands", "SMA ± 2σ"]] },
  { title: "Momentum", rows: [["Relative Strength Index", "100 − 100/(1+RS)"], ["Stochastic oscillator", "(C − L₁₄)/(H₁₄ − L₁₄)"]] },
  { title: "Risk", rows: [["Volatility", "σ · √252"], ["Sharpe ratio", "(μ − r_f) / σ"], ["Maximum drawdown", "min (P / peak − 1)"], ["Value at Risk (95%)", "−q₀.₀₅(r)"]] },
  { title: "Portfolio", rows: [["Correlation matrix", "ρ = cov / σₐσ_b"], ["Beta vs. index", "cov(r, r_m) / var(r_m)"], ["Efficient frontier", "max μᵀw  s.t. wᵀΣw"]] },
  { title: "Forecasting", rows: [["Linear regression trend", "ŷ = a + bt"], ["Monte Carlo, 1,000 paths", "S · e^(μ+σZ)"]] },
  { title: "Backtesting", rows: [["Rule builder", "SMA₅₀ ↗ SMA₂₀₀"], ["Strategy vs. buy-and-hold", "CAGR, Sharpe, MDD"]] },
];

export default function Landing() {
  const navigate = useNavigate();
  return (
    <>
      <TopBar />
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1 className="display">See the maths behind every price.</h1>
            <p className="lede" style={{ marginTop: 22 }}>
              Search a stock and QuantLens computes the classic quant toolkit from its price history: indicators, risk, forecasts and backtests. Every number shows its formula. No AI, no opinions.
            </p>
            <div style={{ marginTop: 30, maxWidth: 520 }}>
              <SymbolSearch className="search hero-search" placeholder="Try Apple, TSLA or RELIANCE.NS" iconSize={18} />
              <div className="tickers">
                {["AAPL", "NVDA", "TSLA", "MSFT", "RELIANCE.NS", "TCS.NS"].map((s) => (
                  <button key={s} className="chip" onClick={() => navigate(`/s/${s}`)}>{s}</button>
                ))}
              </div>
            </div>
          </div>
          <LiveFan />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 24 }}>
        <div className="wrap">
          <div className="spread" style={{ marginBottom: 28, alignItems: "flex-end" }}>
            <h2 className="h2" style={{ maxWidth: "20ch" }}>Six engines, one price series.</h2>
            <p className="muted" style={{ maxWidth: "46ch", margin: 0 }}>Indicators run in a single pass with rolling windows. Simulations and backtests run as background jobs, and prices are cached so repeat analysis is instant.</p>
          </div>
          <div className="modules">
            {MODULES.map((m) => (
              <div className="module" key={m.title}>
                <h3>{m.title}</h3>
                <ul>
                  {m.rows.map(([name, f]) => (
                    <li key={name}><span>{name}</span><span className="math">{f}</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="wrap">
          <h2 className="h2" style={{ marginBottom: 28 }}>Start free. Upgrade when you start testing ideas.</h2>
          <div className="plans">
            <div className="plan">
              <h3 className="h3">Free</h3>
              <div className="price">₹0</div>
              <ul>
                <li>Every indicator: SMA, EMA, MACD, Bollinger, RSI, Stochastic</li>
                <li>Risk metrics: volatility, Sharpe, drawdown, VaR, beta</li>
                <li>Monte Carlo fan chart and regression trend</li>
                <li>Compare up to 5 stocks on a correlation heatmap</li>
                <li>Watchlist of 5 symbols</li>
              </ul>
              <Link to="/signup" className="btn">Create a free account</Link>
            </div>
            <div className="plan featured">
              <div className="spread"><h3 className="h3">Pro</h3><span className="badge pro">Most useful</span></div>
              <div className="price">₹399<span className="muted" style={{ fontSize: 16, fontWeight: 500 }}> / month</span></div>
              <ul>
                <li>Strategy backtester with your own indicator rules</li>
                <li>Portfolio builder with a live efficient frontier</li>
                <li>Saved strategies</li>
                <li>Price-alert emails</li>
                <li>Unlimited watchlist</li>
              </ul>
              <Link to="/signup" className="btn primary">Start with Pro</Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="wrap spread">
          <span>QuantLens computes statistics from historical prices. It is not investment advice, and past returns don't predict future ones.</span>
          <span>Price data: Yahoo Finance</span>
        </div>
      </footer>
    </>
  );
}
