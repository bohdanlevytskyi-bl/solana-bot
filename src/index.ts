import { loadConfig } from "./config";
import { log } from "./logger";
import { Wallet } from "./wallet";
import { PumpFunMonitor, NewTokenEvent } from "./monitor";
import { TokenFilter } from "./filters";
import { createTrader, PaperTrader } from "./trading";
import { PositionManager } from "./positions";
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

  // Display startup banner
  log.banner([
    "╔══════════════════════════════════════════╗",
    "║       Pump.fun Sniper Bot v1.0.0         ║",
    "╚══════════════════════════════════════════╝",
  ]);

  log.info(`Execution mode : ${config.mode.toUpperCase()}`);
  log.info(`Sniping mode   : ${config.snipeMode}`);
  log.info(`Buy amount     : ${config.buyAmountSol} SOL`);
  log.info(`Slippage       : ${config.slippagePct}%`);
  log.info(`Take profit    : ${config.takeProfitPct}%`);
  log.info(`Stop loss      : ${config.stopLossPct}%`);
  log.info(`Priority fee   : ${config.priorityFeeLamports} lamports`);
  console.log("");

  // Production mode confirmation
  if (config.mode === "production") {
    await confirmProduction();
  } else {
    log.paper("════════════════════════════════════════════");
    log.paper("  PAPER MODE — No real trades will be made  ");
    log.paper("════════════════════════════════════════════");
    console.log("");
  }

  // Initialize wallet
  const wallet = new Wallet(config);
  await wallet.printBalance();
  console.log("");

  // Initialize trader (paper or live)
  const trader = createTrader(config, wallet);
  if (trader instanceof PaperTrader) {
    await trader.initialize();
  }

  // Initialize modules
  const filter = new TokenFilter(config);
  const positionManager = new PositionManager(config, trader);
  const monitor = new PumpFunMonitor(config);

  // Handle new tokens
  monitor.on("newToken", async (token: NewTokenEvent) => {
    // Apply filters
    const filterResult = await filter.apply(token);
    if (!filterResult.passed) {
      log.info(
        `Filtered out ${token.symbol} (${token.mint.substring(0, 8)}...): ${filterResult.reason}`
      );
      return;
    }

    // Execute buy
    log.info(`Sniping ${token.name} (${token.symbol})...`);
    const result = await trader.buy(token.mint, config.buyAmountSol);

    if (result.success) {
      positionManager.addPosition(token.mint, result);
    } else {
      log.error(`Failed to buy ${token.symbol}: ${result.error}`);
    }
  });

  // Start position monitoring (auto-sell)
  positionManager.startMonitoring();

  // Start listening for new tokens
  await monitor.start();

  log.success("Bot is running. Press Ctrl+C to stop.");
  console.log("");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("");
    log.info("Shutting down...");

    positionManager.stopMonitoring();
    await monitor.stop();

    const openPositions = positionManager.getOpenPositions();
    if (openPositions.length > 0) {
      log.warn(`${openPositions.length} open position(s) remaining:`);
      for (const pos of openPositions) {
        log.warn(
          `  ${pos.mint.substring(0, 8)}... | ${pos.tokenAmount.toFixed(0)} tokens | bought at ${pos.buyPrice.toFixed(10)}`
        );
      }
    }

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
