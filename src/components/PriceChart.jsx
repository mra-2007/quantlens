import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, AreaSeries, LineStyle, LineType } from "lightweight-charts";
import { C, REGIME_TINT } from "../lib/format";

const toLine = (candles, values) => candles.map((c, i) => (values[i] == null ? { time: c.time } : { time: c.time, value: values[i] }));

// eslint-disable-next-line react-refresh/only-export-components
export const OVERLAYS = [
  { key: "sma20", label: "SMA 20", color: C.sky },
  { key: "sma50", label: "SMA 50", color: C.amber },
  { key: "sma200", label: "SMA 200", color: C.violet },
  { key: "ema12", label: "EMA 12", color: "#7CE0C8" },
  { key: "ema26", label: "EMA 26", color: "#FF8FB1" },
  { key: "bb", label: "Bollinger (20, 2σ)", color: "#8A9AB3" },
  { key: "trend", label: "Regression trend", color: C.amber, dashed: true },
];

/**
 * Candlestick chart (TradingView Lightweight Charts v5) with indicator overlays in
 * the main pane and one oscillator pane underneath.
 */
export default function PriceChart({ data, overlays, oscillator, regime = null }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!data || !ref.current) return;
    const { candles } = data;
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: C.muted,
        fontFamily: "Hanken Grotesk, system-ui, sans-serif",
        fontSize: 12,
        panes: { separatorColor: C.rule, separatorHoverColor: "#2C3F5C", enableResize: true },
        attributionLogo: true,
      },
      grid: { vertLines: { color: "rgba(34,50,74,0.55)" }, horzLines: { color: "rgba(34,50,74,0.55)" } },
      rightPriceScale: { borderColor: C.rule },
      timeScale: { borderColor: C.rule, rightOffset: 4 },
      crosshair: { vertLine: { color: "#5D6E88", labelBackgroundColor: "#2C3F5C" }, horzLine: { color: "#5D6E88", labelBackgroundColor: "#2C3F5C" } },
    });

    // Market regimes (Hidden Markov Model): a full-height tint behind the candles, one colour per regime.
    // One stepped area series per regime (gaps where the stock was in another regime) fills without stripes.
    if (regime?.length) {
      const state = new Map(regime.map((p) => [p.time, p.state]));
      REGIME_TINT.forEach((tint, k) => {
        const band = chart.addSeries(AreaSeries, {
          priceScaleId: "regime",
          lineColor: "rgba(0,0,0,0)",
          topColor: tint,
          bottomColor: tint,
          lineWidth: 1,
          lineType: LineType.WithSteps,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
        });
        band.priceScale().applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
        band.setData(candles.map((c) => (state.get(c.time) === k ? { time: c.time, value: 1 } : { time: c.time })));
      });
    }

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
    });
    candle.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    vol.setData(candles.map((c, i) => ({ time: c.time, value: c.volume, color: i && c.close < candles[i - 1].close ? "rgba(255,107,107,0.28)" : "rgba(61,214,181,0.28)" })));

    const line = (values, color, extra = {}, pane = 0) => {
      const s = chart.addSeries(LineSeries, { color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra }, pane);
      s.setData(toLine(candles, values));
      return s;
    };

    const o = data.overlays;
    for (const ov of OVERLAYS) {
      if (!overlays.includes(ov.key)) continue;
      if (ov.key === "bb") {
        line(o.bbUpper, "rgba(138,154,179,0.8)", { lineStyle: LineStyle.Solid, lineWidth: 1 });
        line(o.bbMiddle, "rgba(138,154,179,0.45)", { lineStyle: LineStyle.Dotted, lineWidth: 1 });
        line(o.bbLower, "rgba(138,154,179,0.8)", { lineWidth: 1 });
      } else if (ov.key === "trend") {
        line(o.trend, C.amber, { lineStyle: LineStyle.Dashed, lineWidth: 1.5 });
      } else {
        line(o[ov.key], ov.color);
      }
    }

    const osc = data.oscillators;
    if (oscillator === "RSI") {
      const s = line(osc.rsi, C.violet, { lastValueVisible: true }, 1);
      s.createPriceLine({ price: 70, color: "rgba(255,107,107,0.6)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      s.createPriceLine({ price: 30, color: "rgba(61,214,181,0.6)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
    } else if (oscillator === "MACD") {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
      hist.setData(candles.map((c, i) => (osc.macdHist[i] == null ? { time: c.time } : { time: c.time, value: osc.macdHist[i], color: osc.macdHist[i] >= 0 ? "rgba(61,214,181,0.55)" : "rgba(255,107,107,0.55)" })));
      line(osc.macd, C.sky, { lastValueVisible: true }, 1);
      line(osc.macdSignal, C.amber, {}, 1);
    } else if (oscillator === "Stochastic") {
      const s = line(osc.stochK, C.sky, { lastValueVisible: true }, 1);
      line(osc.stochD, C.amber, {}, 1);
      s.createPriceLine({ price: 80, color: "rgba(255,107,107,0.6)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      s.createPriceLine({ price: 20, color: "rgba(61,214,181,0.6)", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
    }
    const panes = chart.panes();
    if (panes[1]) panes[1].setHeight(140);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, overlays, oscillator, regime]);

  return <div ref={ref} className="chart-box" />;
}
