const nf = (d) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

export const fmt = {
  num: (v, d = 2) => (v == null || !Number.isFinite(v) ? "–" : nf(d).format(v)),
  pct: (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : ""}${nf(d).format(v * 100)}%`),
  pctAbs: (v, d = 1) => (v == null || !Number.isFinite(v) ? "–" : `${nf(d).format(v * 100)}%`),
  money: (v, currency = "USD", d = 2) => {
    if (v == null || !Number.isFinite(v)) return "–";
    try {
      return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
    } catch {
      return nf(d).format(v);
    }
  },
  compact: (v) => (v == null ? "–" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)),
};

export const tone = (v) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "down" : "");

/** Chart palette, kept in sync with the CSS tokens in index.css. */
export const C = {
  ink: "#0E1726",
  panel: "#131E31",
  rule: "#22324A",
  chalk: "#E6ECF5",
  muted: "#8A9AB3",
  amber: "#F2B544",
  up: "#3DD6B5",
  down: "#FF6B6B",
  violet: "#A79BFF",
  sky: "#6CB8FF",
  series: ["#F2B544", "#6CB8FF", "#3DD6B5", "#A79BFF", "#FF8FB1"],
};
