// Correlation heatmap. Diverging scale: sky blue (−1) → panel (0) → amber (+1).
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const NEUTRAL = [24, 37, 59];
const POS = [242, 181, 68];
const NEG = [108, 184, 255];

// eslint-disable-next-line react-refresh/only-export-components
export function corrColor(v) {
  const c = v >= 0 ? mix(NEUTRAL, POS, Math.min(1, v)) : mix(NEUTRAL, NEG, Math.min(1, -v));
  return `rgb(${c.join(",")})`;
}

export default function Heatmap({ symbols, matrix }) {
  const n = symbols.length;
  return (
    <div>
      <div className="heatmap" style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${n}, minmax(0, 1fr))` }} role="table" aria-label="Correlation matrix">
        <div />
        {symbols.map((s) => <div key={s} className="lab top" role="columnheader">{s}</div>)}
        {matrix.map((row, i) => (
          <div key={symbols[i]} style={{ display: "contents" }} role="row">
            <div className="lab" role="rowheader">{symbols[i]}</div>
            {row.map((v, j) => (
              <div key={j} className="cell" role="cell" style={{ background: corrColor(v), color: Math.abs(v) > 0.55 && v > 0 ? "#2A1E05" : "#E6ECF5" }} title={`ρ(${symbols[i]}, ${symbols[j]}) = ${v.toFixed(3)}`}>
                {v.toFixed(2)}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="row small faint" style={{ marginTop: 12, gap: 8 }}>
        <span>−1</span>
        <div style={{ flex: 1, maxWidth: 220, height: 8, borderRadius: 4, background: `linear-gradient(90deg, ${corrColor(-1)}, ${corrColor(0)}, ${corrColor(1)})` }} />
        <span>+1</span>
        <span style={{ marginLeft: 8 }}>Pearson ρ of daily returns</span>
      </div>
    </div>
  );
}
