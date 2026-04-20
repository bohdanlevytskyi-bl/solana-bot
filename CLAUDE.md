# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pump.fun Sniper Bot for Solana. Monitors new token launches on pump.fun, filters by configurable criteria, and executes buy/sell trades on the bonding curve. Supports paper trading (simulated) and production (real SOL) execution modes. Includes a React web dashboard.

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Blockchain:** Solana (via @solana/web3.js)
- **Target Platform:** pump.fun bonding curve
- **RPC:** Helius (free tier) or QuickNode
- **Dashboard:** React + Vite (in `web/`), served by Express
- **Database:** SQLite via better-sqlite3 (`sniper.db`)

## Build & Run Commands

```bash
npm install              # install bot dependencies
cd web && npm install    # install frontend dependencies
npm run build            # compile bot TypeScript to dist/
npm run build:web        # build React frontend
npm run build:all        # build both bot + frontend
npm run start            # run the compiled bot
npm run dev              # run directly via ts-node
```

## Architecture

Pipeline: `monitor → filters → trading → positions`

- **src/config.ts** — typed config loaded from .env, validates all settings
- **src/wallet.ts** — Keypair management, balance checks, transaction signing
- **src/monitor.ts** — WebSocket listener on pump.fun program, emits `newToken` events
- **src/filters.ts** — token metadata + creator history checks (bypassed in aggressive mode)
- **src/trading.ts** — `Trader` interface with `PaperTrader` (simulated) and `LiveTrader` (real). Factory: `createTrader(config, wallet)`
- **src/positions.ts** — tracks open positions in memory + SQLite, polls prices, auto-sells at TP/SL
- **src/db.ts** — SQLite persistence for positions and trade history
- **src/stats.ts** — session statistics singleton (tokens seen, filtered, sniped, P&L)
- **src/api.ts** — Express + WebSocket server exposing bot data to the React dashboard
- **src/logger.ts** — colored console output (buy/sell/paper/error)
- **src/index.ts** — wires everything together, handles startup and graceful shutdown

### Web Dashboard (`web/`)
- React + Vite SPA, dark theme
- Connects to bot via WebSocket (`/ws`) for real-time updates every 2s
- REST endpoints under `/api/` for trade history
- Built files in `web/dist/` served by Express in production

## Key Concepts

- **Two execution modes:** `MODE=paper` (default, safe) and `MODE=production` (real trades)
- **Two sniping modes:** `SNIPE_MODE=aggressive` (buy everything) and `SNIPE_MODE=filtered` (check metadata first)
- **Exit behavior:** `EXIT_BEHAVIOR=keep` saves positions to DB for resume, `EXIT_BEHAVIOR=sell` sells all on exit
- **Dashboard:** runs at `http://localhost:DASHBOARD_PORT` (default 3001)
- Pump.fun uses a bonding curve — price increases as more tokens are bought
- Priority fees via ComputeBudgetProgram (not Jito bundles)
- Private keys loaded from .env — never committed to git
