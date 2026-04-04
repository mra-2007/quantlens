import { useEffect, useState } from "react";
import { getStockPrice, getSymbol } from "../utils/stock";
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

export default function Dashboard() {
  const [portfolio, setPortfolio] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [amount, setAmount] = useState("");
  const [prediction, setPrediction] = useState(null);
  const [chartData, setChartData] = useState([]);

  useEffect(() => {
    const stocks = [
      { name: "Tesla", invested: 500 },
      { name: "Apple", invested: 400 },
      { name: "Amazon", invested: 300 },
    ];

    fetchPortfolio(stocks);
  }, []);

  const fetchPortfolio = async (stocks) => {
    const updated = await Promise.all(
      stocks.map(async (stock) => {
        const symbol = getSymbol(stock.name);
        const priceData = await getStockPrice(symbol);

        const current = priceData?.current || stock.invested;

        return {
          ...stock,
          current,
          profit: current - stock.invested,
        };
      })
    );

    setPortfolio(updated);
  };

  const handleInvest = async () => {
    if (!amount || amount <= 0) return alert("Enter valid amount");

    const result = await getAnalysis({
      name: selectedStock.name,
      price: selectedStock.current,
      amount,
    });

    const growth = result.scores.growth || 50;

    let base = Number(amount);

    const graph = Array.from({ length: 12 }, (_, i) => {
      base += base * (growth / 1000);
      return {
        month: `M${i + 1}`,
        value: parseFloat(base.toFixed(2)),
      };
    });

    setChartData(graph);

    setPrediction({
      invested: amount,
      growth,
      risk: result.scores.risk,
      verdict: result.verdict,
      finalValue: base.toFixed(2),
    });
  };

  return (
    <div className="relative min-h-screen bg-black text-white p-6 overflow-hidden">

      {/* 🌌 BACKGROUND */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute w-[600px] h-[600px] bg-purple-500 blur-[150px] opacity-20 top-0 left-0 animate-pulse"></div>
        <div className="absolute w-[600px] h-[600px] bg-blue-500 blur-[150px] opacity-20 bottom-0 right-0 animate-pulse"></div>
      </div>

      <h1 className="text-4xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent mb-6">
        Portfolio Dashboard
      </h1>

      {/* STOCK CARDS */}
      <div className="grid md:grid-cols-3 gap-6">
        {portfolio.map((stock) => (
          <motion.div
            key={stock.name}
            whileHover={{ scale: 1.05 }}
            className="p-5 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-xl"
          >
            <h2 className="text-xl font-semibold">{stock.name}</h2>

            <p className="mt-2 text-gray-300">
              ${stock.invested} → ${stock.current.toFixed(2)}
            </p>

            <p className={stock.profit >= 0 ? "text-green-400" : "text-red-400"}>
              {stock.profit >= 0 ? "▲ Profit" : "▼ Loss"}: $
              {stock.profit.toFixed(2)}
            </p>

            <button
              onClick={() => {
                setSelectedStock(stock);
                setPrediction(null);
                setChartData([]);
              }}
              className="mt-4 w-full py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600"
            >
              Invest
            </button>
          </motion.div>
        ))}
      </div>

      {/* INVEST MODAL */}
      {selectedStock && (
        <div className="fixed inset-0 bg-black/70 flex justify-center items-center">
          <div className="bg-gray-900 p-6 rounded-xl w-80">
            <h2 className="text-xl mb-3">
              Invest in {selectedStock.name}
            </h2>

            <input
              type="number"
              placeholder="Amount ($)"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded mb-3"
            />

            <button
              onClick={handleInvest}
              className="bg-blue-600 w-full py-2 rounded"
            >
              Predict Investment
            </button>

            <button
              onClick={() => setSelectedStock(null)}
              className="mt-2 text-red-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* AI RESULT + GRAPH */}
      {prediction && (
        <div className="mt-10 bg-white/5 backdrop-blur-xl p-6 rounded-2xl border border-white/10">

          <h3 className="text-xl font-bold mb-3">
            AI Investment Prediction
          </h3>

          <p>💰 Invested: ${prediction.invested}</p>
          <p>📈 Final Value: ${prediction.finalValue}</p>
          <p>📊 Growth Score: {prediction.growth}</p>

          <p
            className={
              prediction.verdict === "INVEST"
                ? "text-green-400"
                : "text-red-400"
            }
          >
            {prediction.verdict}
          </p>

          <div className="mt-6">
            <LineChart width={700} height={300} data={chartData}>
              <CartesianGrid stroke="#333" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />

              <Line
                type="monotone"
                dataKey="value"
                stroke="#22c55e"
                strokeWidth={4}
                dot={false}
              />
            </LineChart>
          </div>

        </div>
      )}

    </div>
  );
}