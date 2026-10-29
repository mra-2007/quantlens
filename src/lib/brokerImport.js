// Reads a broker holdings statement (Groww, Zerodha, Upstox… as .xlsx or .csv) and
// finds the holdings table in it. Column names differ between brokers, so columns
// are matched by keywords and the user confirms everything in a preview.

/** Minimal CSV parser with quoted-field support. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export async function readRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt")) return parseCsv(await file.text());
  if (name.endsWith(".xlsx")) {
    const { readSheet } = await import("read-excel-file/browser");
    return await readSheet(file);
  }
  throw new Error("Choose an .xlsx or .csv file. Older .xls files: open in Excel and save as .xlsx first.");
}

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9%.]+/g, " ").trim();
const num = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[₹$,\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
};

const find = (cells, tests) => cells.findIndex((c) => tests.some((t) => t(c)));
const has = (...words) => (c) => words.every((w) => c.includes(w));
const not = (test, ...words) => (c) => test(c) && !words.some((w) => c.includes(w));

/**
 * Finds the header row and the holdings below it.
 * @returns {{ items: {symbol?:string, name?:string, isin?:string, quantity:number, avgPrice:number}[], columns: Record<string,string>, skipped: number }}
 */
export function detectHoldings(rows) {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = rows[r].map(norm);
    const qty = find(cells, [not(has("qty"), "value", "pledg"), not(has("quantity"), "value", "pledg"), has("shares")]);
    const isin = find(cells, [has("isin")]);
    const symbol = find(cells, [has("symbol"), has("ticker"), has("scrip"), (c) => c === "instrument"]);
    const name = find(cells, [has("stock name"), has("company"), has("security"), has("instrument"), (c) => c === "name" || c === "stock" || c === "stocks"]);
    if (qty < 0 || (symbol < 0 && name < 0 && isin < 0)) continue;

    const avg = find(cells, [not(has("avg"), "value"), not(has("average"), "value"), not(has("buy price"), "value"), not(has("cost price"), "value"), not(has("purchase price"), "value")]);
    const invested = find(cells, [has("buy value"), has("invested"), has("purchase value"), has("cost value"), has("buy amount")]);

    const items = [];
    let skipped = 0;
    for (let i = r + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c) => String(c ?? "").trim() === "")) { if (items.length) break; continue; }
      const q = num(row[qty]);
      const label = String(row[symbol] ?? row[name] ?? row[isin] ?? "").trim();
      if (!(q > 0) || !label || /^total/i.test(label)) { skipped++; continue; }
      let price = avg >= 0 ? num(row[avg]) : NaN;
      if (!(price >= 0) && invested >= 0) price = num(row[invested]) / q;
      items.push({
        symbol: symbol >= 0 ? String(row[symbol] ?? "").trim() || undefined : undefined,
        name: name >= 0 ? String(row[name] ?? "").trim() || undefined : undefined,
        isin: isin >= 0 ? String(row[isin] ?? "").trim() || undefined : undefined,
        quantity: q,
        avgPrice: price >= 0 ? price : 0,
      });
    }
    const header = rows[r];
    const label = (i) => (i >= 0 ? String(header[i]) : null);
    return { items, skipped, columns: { symbol: label(symbol), name: label(name), isin: label(isin), quantity: label(qty), avgPrice: label(avg) ?? (invested >= 0 ? `${label(invested)} ÷ quantity` : null) } };
  }
  throw new Error("Couldn't find a holdings table. The file needs a quantity column and a stock name, symbol or ISIN column.");
}
