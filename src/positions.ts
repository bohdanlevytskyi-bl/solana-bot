import { BotConfig } from "./config";
import { Trader, TradeResult } from "./trading";
import { log } from "./logger";

export interface Position {
  mint: string;
  tokenAmount: number;
  buyPrice: number;
  buySolAmount: number;
  buyTimestamp: number;
  signature?: string;
}

export class PositionManager {
  private positions: Map<string, Position> = new Map();
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: BotConfig,
    private trader: Trader
  ) {}

  addPosition(
    mint: string,
    result: TradeResult
  ): void {
    if (!result.success || !result.tokenAmount || !result.price) return;

    const position: Position = {
      mint,
      tokenAmount: result.tokenAmount,
      buyPrice: result.price,
      buySolAmount: result.solAmount,
      buyTimestamp: Date.now(),
      signature: result.signature,
    };

    this.positions.set(mint, position);
    log.info(
      `Position opened: ${mint.substring(0, 8)}... | ${result.tokenAmount.toFixed(0)} tokens @ ${result.price.toFixed(10)}`
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

        // Take profit
        if (pnlPct >= this.config.takeProfitPct) {
          log.info(
            `Take profit triggered for ${mint.substring(0, 8)}... (+${pnlPct.toFixed(1)}%)`
          );
          await this.closePosition(mint, position);
          continue;
        }

        // Stop loss
        if (pnlPct <= -this.config.stopLossPct) {
          log.warn(
            `Stop loss triggered for ${mint.substring(0, 8)}... (${pnlPct.toFixed(1)}%)`
          );
          await this.closePosition(mint, position);
          continue;
        }
      } catch (err) {
        log.error(`Error checking position ${mint.substring(0, 8)}...: ${err}`);
      }
    }
  }

  private async closePosition(
    mint: string,
    position: Position
  ): Promise<void> {
    const result = await this.trader.sell(mint, position.tokenAmount);

    if (result.success) {
      const pnl = result.solAmount - position.buySolAmount;
      const pnlStr = `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL`;
      log.sell(mint.substring(0, 8) + "...", result.solAmount.toFixed(4), pnlStr);
      this.positions.delete(mint);
    } else {
      log.error(`Failed to close position ${mint.substring(0, 8)}...: ${result.error}`);
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
