import { ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { C, fmt } from "../lib/format";
import { ChartTip } from "./ui";

/**
 * Monte Carlo fan chart: 5–95% and 25–75% percentile bands as range areas,
 * the median path, and a few raw sample paths for texture.
 */
export default function FanChart({ result, history = [], currency }) {
  const tail = history.slice(-60);
  const n = tail.length;
  const rows = [
    ...tail.map((c, i) => ({ x: i - n + 1, price: c.close })),
    ...result.bands.slice(1).map((b) => ({ x: b.step })),
  ];
  result.bands.forEach((b) => {
    const row = b.step === 0 ? rows[n - 1] : rows[n - 1 + b.step];
    Object.assign(row, {
      outer: [b.p5, b.p95],
      inner: [b.p25, b.p75],
      p5: b.p5, p25: b.p25, p50: b.p50, p75: b.p75, p95: b.p95,
    });
    result.samplePaths.slice(0, 12).forEach((path, k) => {
      row[`s${k}`] = path[b.step];
    });
  });

  return (
    <ResponsiveContainer width="100%" height={380}>
      <ComposedChart data={rows} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={C.rule} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="x" type="number" domain={["dataMin", "dataMax"]} tick={{ fill: C.muted, fontSize: 12 }} tickFormatter={(v) => (v === 0 ? "today" : v > 0 ? `+${v}d` : `${v}d`)} stroke={C.rule} />
        <YAxis tick={{ fill: C.muted, fontSize: 12 }} stroke={C.rule} width={64} domain={["auto", "auto"]} tickFormatter={(v) => fmt.num(v, 0)} />
        <Tooltip
          content={<ChartTip labelFormat={(l) => (l > 0 ? `Day +${l}` : l === 0 ? "Today" : `${-l} days ago`)} format={(v) => fmt.money(v, currency)} filter={(p) => ["price", "p95", "p50", "p5"].includes(p.dataKey)} />}
        />
        <Area dataKey="outer" stroke="none" fill={C.amber} fillOpacity={0.14} isAnimationActive={false} name="5–95%" activeDot={false} />
        <Area dataKey="inner" stroke="none" fill={C.amber} fillOpacity={0.24} isAnimationActive={false} name="25–75%" activeDot={false} />
        {result.samplePaths.slice(0, 12).map((_, k) => (
          <Line key={k} dataKey={`s${k}`} stroke={C.chalk} strokeOpacity={0.13} dot={false} strokeWidth={1} isAnimationActive={false} legendType="none" name={`path ${k + 1}`} activeDot={false} />
        ))}
        <Line dataKey="p50" stroke={C.amber} strokeWidth={2} dot={false} isAnimationActive={false} name="Median" />
        <Line dataKey="p95" stroke="none" dot={false} isAnimationActive={false} name="95th pct" activeDot={false} />
        <Line dataKey="p5" stroke="none" dot={false} isAnimationActive={false} name="5th pct" activeDot={false} />
        <Line dataKey="price" stroke={C.chalk} strokeWidth={1.75} dot={false} isAnimationActive={false} name="Price" />
        <ReferenceLine x={0} stroke={"#5D6E88"} strokeDasharray="3 3" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
