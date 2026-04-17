# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pump.fun Sniper Bot for Solana. Monitors new token launches on pump.fun, filters by configurable criteria, and executes buy/sell trades on the bonding curve. Supports paper trading (simulated) and production (real SOL) execution modes.

## Tech Stack

- **Runtime:** Node.js with TypeScript
- **Blockchain:** Solana (via @solana/web3.js)
- **Target Platform:** pump.fun bonding curve
- **RPC:** Helius (free tier) or QuickNode

## Build & Run Commands

```bash
npm install          # install dependencies
npm run build        # compile TypeScript to dist/
npm run start        # run the compiled bot
npm run dev          # run directly via ts-node
```

## Architecture

Pipeline: `monitor → filters → trading → positions`

- **src/config.ts** — typed config loaded from .env, validates all settings
- **src/wallet.ts** — Keypair management, balance checks, transaction signing
- **src/monitor.ts** — WebSocket listener on pump.fun program, emits `newToken` events
- **src/filters.ts** — token metadata + creator history checks (bypassed in aggressive mode)
- **src/trading.ts** — `Trader` interface with `PaperTrader` (simulated) and `LiveTrader` (real) implementations. Factory: `createTrader(config, wallet)`
- **src/positions.ts** — tracks open positions, polls prices, auto-sells at TP/SL thresholds
- **src/logger.ts** — colored console output (buy/sell/paper/error)
- **src/index.ts** — wires everything together, handles startup banner and graceful shutdown

## Key Concepts

- **Two execution modes:** `MODE=paper` (default, safe) and `MODE=production` (real trades, requires Enter confirmation)
- **Two sniping modes:** `SNIPE_MODE=aggressive` (buy everything) and `SNIPE_MODE=filtered` (check metadata first)
- Pump.fun uses a bonding curve — price increases as more tokens are bought
- Priority fees via ComputeBudgetProgram (not Jito bundles)
- Private keys loaded from .env — never committed to git
