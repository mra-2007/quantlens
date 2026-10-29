# QuantLens

A mathematical stock analysis platform. Search a stock and QuantLens computes classic
quantitative indicators, risk metrics, forecasts and backtests from its price history.
No AI, only math.

Full Stack Web Development (22CAC11N) project.

## Documents

- [Project report (PDF)](docs/QuantLens_FSD_Project_Report.pdf)
- [Presentation (PDF)](docs/QuantLens_Presentation.pdf)

## Features

- **Trend:** SMA, EMA, MACD, Bollinger Bands
- **Momentum:** RSI, Stochastic oscillator
- **Risk:** volatility, Sharpe, Sortino, max drawdown, Value at Risk, beta vs index
- **Portfolio:** correlation heatmap (2–5 stocks), Markowitz efficient frontier
- **Forecasting:** linear regression trend, Monte Carlo fan chart (1,000 paths)
- **Backtesting:** build rules from indicators and thresholds, compare with buy-and-hold
- **My portfolio:** add your holdings or import a Groww / Zerodha / CSV statement; see value, P&L, allocation, trend, risk and correlation (USD stocks converted to ₹)
- **Each stock, analysed:** for every holding, 8 mechanical signals (SMA 50/200, golden cross, MACD, RSI, Stochastic, Bollinger %B, regression slope), risk metrics and its own Monte Carlo forecast applied to your quantity
- **What if I invest more?** Monte Carlo before-and-after: likely value, bad and good case, chance of profit and how risk and diversification change
- **Accounts:** JWT login, watchlist, saved strategies, price-alert emails, Free/Pro plans

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + Vite, React Router, TradingView Lightweight Charts, Recharts |
| Backend | Node.js + Express 5, Zod, Helmet, rate limiting |
| Data | Yahoo Finance (`yahoo-finance2`, no key) or Alpha Vantage |
| Database | PostgreSQL (optional locally, in-memory fallback) |
| Cache / jobs | Redis + BullMQ (optional locally, in-process fallback) |
| Auth | JWT + bcrypt |

## Run it (2 terminals)

Requires Node.js 20 or newer.

**Terminal 1: API**
```bash
cd server
npm install
npm run dev
```
The API starts on http://localhost:4000. Settings live in `server/.env`
(copy from `server/.env.example`). Use `DATA_PROVIDER=demo` to run offline with simulated prices.

**Terminal 2: frontend**
```bash
npm install
npm run dev
```
Open http://localhost:5173. The frontend proxies `/api` to the server.

## Optional: PostgreSQL + Redis

```bash
docker compose up -d
```
Then set in `server/.env`:
```
DATABASE_URL=postgres://quantlens:quantlens@localhost:5432/quantlens
REDIS_URL=redis://localhost:6379
```
and run `cd server && npm run migrate`.

## Tests

```bash
cd server
npm test
```
21 tests check the math engine and portfolio maths against naive reference implementations.

## Project structure

```
src/                React frontend (pages, components, lib)
server/src/quant/   math engine (indicators, risk, portfolio, forecast, backtest)
server/src/lib/     market data, cache, auth, alerts
server/src/jobs/    BullMQ queue and worker
server/src/db/      schema.sql and data access
server/src/routes/  REST API
server/test/        automated tests
```

QuantLens computes statistics from historical prices. It is not investment advice.
