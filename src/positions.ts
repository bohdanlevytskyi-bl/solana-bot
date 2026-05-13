import { BotConfig } from "./config";
import { Trader, TradeResult } from "./trading";
import { log } from "./logger";
import { stats } from "./stats";
import { DB } from "./db";

export interface Position {
  mint: string;
  tokenAmount: number;
  buyPrice: number;
  buySolAmount: number;
  buyTimestamp: number;
  signature?: string;
  name?: string;
  symbol?: string;
  currentPrice?: number;
  priceUpdatedAt?: number;
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private selling: Set<string> = new Set();
  private sellFailures: Map<string, number> = new Map();
  private static readonly MAX_SELL_FAILURES = 5;

  constructor(
    private config: BotConfig,
    private trader: Trader,
    private db: DB
  ) {}

  loadFromDb(): void {
    const saved = this.db.loadPositions();
    for (const pos of saved) {
      this.positions.set(pos.mint, pos);
    }
    if (saved.length > 0) {
      log.info(`Resumed ${saved.length} position(s) from database`);
    }
  }

  addPosition(
    mint: string,
    result: TradeResult,
    name?: string,
    symbol?: string
  ): void {
    if (!result.success || !result.tokenAmount || !result.price) return;

    const position: Position = {
      mint,
      tokenAmount: result.tokenAmount,
      buyPrice: result.price,
      buySolAmount: result.solAmount,
      buyTimestamp: Date.now(),
      signature: result.signature,
      name,
      symbol,
    };

    this.positions.set(mint, position);
    this.db.savePosition(position);
    this.db.recordTrade({
      mint,
      type: "buy",
      solAmount: result.solAmount,
      tokenAmount: result.tokenAmount,
      price: result.price,
      signature: result.signature,
      name,
      symbol,
    });

    log.info(
      `Position opened: ${name || mint.substring(0, 8) + "..."} | ${result.tokenAmount.toFixed(0)} tokens @ ${result.price.toFixed(10)}`
    );
  }

  startMonitoring(): void {
    if (this.pollInterval) return;

    log.info(
      `Position monitor started (TP: ${this.config.takeProfitPct}%, SL: ${this.config.stopLossPct}%)`
    );

    // Check positions every 5 seconds
    this.pollInterval = setInterval(() => {
      this.checkPositions();
    }, 5000);
  }

  private async checkPositions(): Promise<void> {
    if (this.positions.size === 0) {
      log.debug(`[POLL] No open positions`);
      return;
    }

    for (const [mint, position] of this.positions) {
      if (this.selling.has(mint)) continue;
      const label = position.name || mint.substring(0, 8) + "...";
      try {
        const currentPrice = await this.trader.getTokenPrice(mint);

        if (currentPrice === null) {
          log.debug(`[POLL] ${label}: price fetch returned null — skipping`);
          continue;
        }

        const prevPrice = position.currentPrice;
        position.currentPrice = currentPrice;
        position.priceUpdatedAt = Date.now();

        const currentValue = currentPrice * position.tokenAmount;
        const pnlSol = currentValue - position.buySolAmount;
        const pnlPct =
          position.buySolAmount > 0
            ? (pnlSol / position.buySolAmount) * 100
            : 0;
        const ageMinutes = (Date.now() - position.buyTimestamp) / 60_000;
        const priceChange =
          prevPrice && prevPrice > 0
            ? ((currentPrice - prevPrice) / prevPrice) * 100
            : 0;

        log.debug(
          `[POLL] ${label} | price=${currentPrice.toExponential(3)}` +
          ` (${priceChange >= 0 ? "+" : ""}${priceChange.toFixed(2)}% vs last poll)` +
          ` | P&L=${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)` +
          ` | age=${ageMinutes.toFixed(1)}min` +
          ` | TP@+${this.config.takeProfitPct}% SL@-${this.config.stopLossPct}%` +
          (this.config.maxHoldMinutes ? ` hold@${this.config.maxHoldMinutes}min` : "")
        );

        // Skip auto-sell if too many consecutive failures
        const failures = this.sellFailures.get(mint) ?? 0;
        if (failures >= PositionManager.MAX_SELL_FAILURES) continue;

        // Take profit
        if (pnlPct >= this.config.takeProfitPct) {
          log.info(`Take profit triggered for ${label} (+${pnlPct.toFixed(1)}%)`);
          await this.closePosition(mint, position);
          continue;
        }

        // Stop loss
        if (pnlPct <= -this.config.stopLossPct) {
          log.warn(`Stop loss triggered for ${label} (${pnlPct.toFixed(1)}%)`);
          await this.closePosition(mint, position);
          continue;
        }

        // Max hold time
        if (this.config.maxHoldMinutes !== null) {
          if (ageMinutes >= this.config.maxHoldMinutes) {
            log.warn(`Max hold time reached for ${label} (${ageMinutes.toFixed(1)}min, ${pnlPct.toFixed(1)}%)`);
            await this.closePosition(mint, position);
            continue;
          }
        }
      } catch (err) {
        log.error(`Error checking position ${label}: ${err}`);
      }
    }
  }

  private recordSellFailure(mint: string, label: string): boolean {
    const failures = (this.sellFailures.get(mint) ?? 0) + 1;
    this.sellFailures.set(mint, failures);
    if (failures >= PositionManager.MAX_SELL_FAILURES) {
      log.error(`[SELL] ${label}: ${failures} consecutive failures — pausing auto-sell. Use manual sell button or restart bot.`);
      return true; // caller should stop retrying
    }
    log.warn(`[SELL] ${label}: failure ${failures}/${PositionManager.MAX_SELL_FAILURES}`);
    return false;
  }

  async sellPosition(mint: string): Promise<{ success: boolean; error?: string }> {
    const position = this.positions.get(mint);
    if (!position) return { success: false, error: "Position not found" };
    if (this.selling.has(mint)) return { success: false, error: "Sell already in progress" };

    this.selling.add(mint);
    try {
      await this.closePosition(mint, position);
      return { success: true };
    } finally {
      this.selling.delete(mint);
    }
  }

  private async closePosition(
    mint: string,
    position: Position
  ): Promise<void> {
    const result = await this.trader.sell(mint, position.tokenAmount);
    const label = position.name || mint.substring(0, 8) + "...";

    if (result.success) {
      this.sellFailures.delete(mint);
      const pnl = result.solAmount - position.buySolAmount;
      const pnlStr = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL`;
      log.sell(label, result.solAmount.toFixed(4), pnlStr);
      stats.recordSell(label, pnl);

      this.db.recordTrade({
        mint,
        type: "sell",
        solAmount: result.solAmount,
        tokenAmount: position.tokenAmount,
        price: result.price,
        pnlSol: pnl,
        signature: result.signature,
        name: position.name,
        symbol: position.symbol,
      });
      this.db.removePosition(mint);
      this.positions.delete(mint);
    } else {
      log.error(`Failed to close position ${label}: ${result.error}`);
      this.recordSellFailure(mint, label);
    }
  }

  async sellAll(): Promise<void> {
    const positions = Array.from(this.positions.entries());
    if (positions.length === 0) return;

    log.info(`Selling all ${positions.length} open position(s)...`);
    for (const [mint, position] of positions) {
      await this.closePosition(mint, position);
    }
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  stopMonitoring(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      log.info("Position monitor stopped");
    }
  }
}
