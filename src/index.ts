import { loadConfig } from "./config";
import { log } from "./logger";
import { Wallet } from "./wallet";
import { PumpFunMonitor, NewTokenEvent } from "./monitor";
import { TokenFilter } from "./filters";
import { createTrader, PaperTrader } from "./trading";
import { PositionManager } from "./positions";
import { startApiServer } from "./api";
import { stats } from "./stats";
import { DB } from "./db";
import * as readline from "readline";

async function confirmProduction(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    console.log("");
    log.warn("╔══════════════════════════════════════════════════╗");
    log.warn("║       ⚠  PRODUCTION MODE — REAL SOL  ⚠         ║");
    log.warn("║  You are about to trade with REAL money.        ║");
    log.warn("║  Losses are possible and irreversible.          ║");
    log.warn("╚══════════════════════════════════════════════════╝");
    console.log("");

    rl.question("  Press ENTER to continue or Ctrl+C to abort... ", () => {
      rl.close();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  // Load configuration
  const config = loadConfig();

  // Initialize database
  const db = new DB();

  // Seed stats from DB so P&L / wins / losses / sniped persist across restarts
  const counts = db.getTradeCount();
  stats.hydrate({
    pnl: db.getTotalPnl(),
    wins: counts.wins,
    losses: counts.losses,
    sniped: counts.buys,
  });

  // Display startup banner
  log.banner([
    "╔══════════════════════════════════════════╗",
    "║       Pump.fun Sniper Bot v1.0.0         ║",
    "╚══════════════════════════════════════════╝",
  ]);

  log.info(`Execution mode : ${config.mode.toUpperCase()}`);
  log.info(`Sniping mode   : ${config.snipeMode}`);
  log.info(`Buy amount     : ${config.buyAmountSol} SOL`);
  log.info(`On exit        : ${config.exitBehavior === "sell" ? "sell all positions" : "keep positions (resume on restart)"}`);
  console.log("");

  // Production mode confirmation
  if (config.mode === "production") {
    await confirmProduction();
  } else {
    log.paper("PAPER MODE — No real trades will be made");
    console.log("");
  }

  // Initialize wallet
  const wallet = new Wallet(config);
  await wallet.printBalance();
  console.log("");

  // Initialize trader (paper or live)
  const trader = createTrader(config, wallet);
  if (trader instanceof PaperTrader) {
    await trader.initialize(db);
  }

  // Initialize modules
  const filter = new TokenFilter(config);
  const positionManager = new PositionManager(config, trader, db);
  const monitor = new PumpFunMonitor(config);

  // Resume positions from database
  positionManager.loadFromDb();

  // Handle new tokens
  monitor.on("newToken", async (token: NewTokenEvent) => {
    stats.recordDetected(token.name, token.symbol, token.mint);

    // Apply filters
    const filterResult = await filter.apply(token);
    if (!filterResult.passed) {
      stats.recordFiltered(
        token.symbol,
        filterResult.reason || "Unknown"
      );
      return;
    }

    // Execute buy
    log.info(`Sniping ${token.name} (${token.symbol})...`);
    const result = await trader.buy(token.mint, config.buyAmountSol);

    if (result.success) {
      stats.recordSniped(token.name, token.symbol, config.buyAmountSol);
      positionManager.addPosition(token.mint, result, token.name, token.symbol);
    } else {
      stats.recordError(`Buy failed: ${token.symbol} — ${result.error}`);
      log.error(`Failed to buy ${token.symbol}: ${result.error}`);
    }
  });

  // Start position monitoring (auto-sell)
  positionManager.startMonitoring();

  // Start listening for new tokens
  await monitor.start();

  // Start web dashboard API server
  const server = startApiServer({ config, positionManager, wallet, db });

  log.success("Bot is running. Press Ctrl+C to stop.");
  console.log("");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("");
    log.info("Shutting down...");

    server.close();
    positionManager.stopMonitoring();
    await monitor.stop();

    // Handle open positions based on exit behavior
    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length > 0) {
      if (config.exitBehavior === "sell") {
        log.info("EXIT_BEHAVIOR=sell — selling all open positions...");
        await positionManager.sellAll();
      } else {
        log.info(
          `${openPositions.length} position(s) saved to database — will resume on next start`
        );
        for (const pos of openPositions) {
          const label = pos.name || pos.mint.substring(0, 8) + "...";
          log.info(
            `  ${label} | ${pos.tokenAmount.toFixed(0)} tokens | bought at ${pos.buyPrice.toFixed(10)}`
          );
        }
      }
    }

    // Print final stats
    console.log("");
    log.info("Session stats:");
    log.info(`  Uptime: ${stats.getUptime()}`);
    log.info(
      `  Tokens seen: ${stats.tokensDetected} | Filtered: ${stats.tokensFiltered} | Sniped: ${stats.tokensSniped}`
    );
    const pnlSign = stats.totalPnlSol >= 0 ? "+" : "";
    log.info(
      `  Total P&L: ${pnlSign}${stats.totalPnlSol.toFixed(4)} SOL | Wins: ${stats.wins} | Losses: ${stats.losses}`
    );

    // Historical stats from DB
    const tradeStats = db.getTradeCount();
    const totalPnl = db.getTotalPnl();
    log.info("All-time stats (from database):");
    log.info(
      `  Buys: ${tradeStats.buys} | Sells: ${tradeStats.sells} | Wins: ${tradeStats.wins} | Losses: ${tradeStats.losses}`
    );
    log.info(`  Total P&L: ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(4)} SOL`);

    db.close();
    log.info("Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error(`Fatal error: ${err}`);
  process.exit(1);
});
