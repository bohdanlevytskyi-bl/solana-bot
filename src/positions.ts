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
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

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
    for (const [mint, position] of this.positions) {
      try {
        const currentPrice = await this.trader.getTokenPrice(mint);
        if (currentPrice === null) continue;

        const pnlPct =
          ((currentPrice - position.buyPrice) / position.buyPrice) * 100;
        const label = position.name || mint.substring(0, 8) + "...";

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
      } catch (err) {
        log.error(
          `Error checking position ${position.name || mint.substring(0, 8) + "..."}: ${err}`
        );
      }
    }
  }

  private async closePosition(
    mint: string,
    position: Position
  ): Promise<void> {
    const result = await this.trader.sell(mint, position.tokenAmount);
    const label = position.name || mint.substring(0, 8) + "...";

    if (result.success) {
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
