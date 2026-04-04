import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAnalysis } from "../utils/gemini";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export default function Report() {
  const { state } = useLocation();

  const [analysis, setAnalysis] = useState(null);
  const [data, setData] = useState([]);
  const [price, setPrice] = useState(null);

  useEffect(() => {
    if (!state?.name) return;

    fetchStockAndAI();
  }, [state]);

  const fetchStockAndAI = async () => {
    const symbol = getSymbol(state.name);

    if (!symbol) {
      getAnalysis(state).then(setAnalysis);
      return;
    }

    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${import.meta.env.VITE_FINNHUB_API_KEY}`
      );

      const stock = await res.json();

      setPrice(stock.c);

      // AI with real price
      const ai = await getAnalysis({
        name: state.name,
        price: stock.c,
      });

      setAnalysis(ai);

      // graph
      let base = stock.c || 100;

      const graph = Array.from({ length: 20 }, (_, i) => {
        base += Math.random() * 4 - 2;
        return {
          time: i,
          value: parseFloat(base.toFixed(2)),
        };
      });

      setData(graph);

    } catch (err) {
      console.error("Stock API error:", err);
      getAnalysis(state).then(setAnalysis);
    }
  };

  if (!analysis) {
    return <div className="text-white p-6">Analyzing...</div>;
  }

  const isUp =
    data.length > 1 &&
    data[data.length - 1].value > data[data.length - 2].value;

  return (
    <div className="min-h-screen bg-black text-white p-6">

      <motion.h1 className="text-4xl font-bold">
        {state?.name}
      </motion.h1>

      <h2 className={`text-3xl mt-2 ${analysis.verdict === "INVEST" ? "text-green-400" : "text-red-400"}`}>
        {analysis.verdict}
      </h2>

      <p className="text-gray-400 mt-2">{analysis.summary}</p>

      {price && (
        <p className="mt-2 text-lg text-blue-400">
          Current Price: ${price}
        </p>
      )}

      {/* GRAPH */}
      <div className="mt-10 bg-gray-900 p-6 rounded-xl">
        <LineChart width={700} height={300} data={data}>
          <CartesianGrid stroke="#333" />
          <XAxis dataKey="time" />
          <YAxis />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="value"
            stroke={isUp ? "#22c55e" : "#ef4444"}
            strokeWidth={3}
            dot={false}
          />
        </LineChart>
      </div>

      {/* SCORES */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-8">
        {Object.entries(analysis.scores).map(([k, v]) => (
          <div key={k} className="bg-gray-800 p-4 rounded-xl">
            <p className="capitalize">{k}</p>
            <p className="text-xl font-bold">{v}</p>
          </div>
        ))}
      </div>

      {/* PROS */}
      <div className="mt-8">
        <h3 className="text-green-400 text-lg">Pros</h3>
        {analysis.pros.map((p, i) => (
          <p key={i}>✔ {p}</p>
        ))}
      </div>

      {/* CONS */}
      <div className="mt-4">
        <h3 className="text-red-400 text-lg">Cons</h3>
        {analysis.cons.map((c, i) => (
          <p key={i}>✖ {c}</p>
        ))}
      </div>

    </div>
  );
}

// 🔑 SIMPLE SYMBOL MAP
function getSymbol(name) {
  const map = {
    apple: "AAPL",
    tesla: "TSLA",
    google: "GOOGL",
    amazon: "AMZN",
    microsoft: "MSFT",
    infosys: "INFY",
    tcs: "TCS.NS",
    reliance: "RELIANCE.NS",
  };

  return map[name?.toLowerCase()];
}