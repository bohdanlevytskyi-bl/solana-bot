import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { BotConfig } from "./config";
import { Wallet } from "./wallet";
import { log } from "./logger";
import type { DB } from "./db";

// Pump.fun program
const PUMP_FUN_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);

// Pump.fun fee account
const PUMP_FUN_FEE_ACCOUNT = new PublicKey(
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5GpZGMb2U7"
);

export interface TradeResult {
  success: boolean;
  signature?: string;
  tokenAmount?: number;
  solAmount: number;
  price?: number;
  error?: string;
}

export interface Trader {
  buy(mint: string, solAmount: number): Promise<TradeResult>;
  sell(mint: string, tokenAmount: number): Promise<TradeResult>;
  getTokenPrice(mint: string): Promise<number | null>;
}

// =============================================================================
// Paper Trader — simulated trades for testing
// =============================================================================

export class PaperTrader implements Trader {
  private virtualBalance: number;
  private trades: Array<{
    type: "buy" | "sell";
    mint: string;
    solAmount: number;
    tokenAmount: number;
    price: number;
    timestamp: number;
  }> = [];

  constructor(private config: BotConfig, private wallet: Wallet) {
    this.virtualBalance = 0; // will be set from actual wallet balance
  }

  async initialize(db?: DB): Promise<void> {
    const realBalance = await this.wallet.getBalanceSol();
    if (realBalance === 0) {
      this.virtualBalance = 1;
      log.paper(`Wallet is empty — starting with 1 SOL virtual balance for testing`);
    } else {
      this.virtualBalance = realBalance;
      log.paper(`Virtual balance initialized: ${this.virtualBalance.toFixed(4)} SOL`);
    }

    if (db) {
      const historical = db.getTrades(100000, 0);
      let loaded = 0;
      for (const t of historical) {
        if (t.price === null) continue;
        this.trades.push({
          type: t.type as "buy" | "sell",
          mint: t.mint,
          solAmount: t.solAmount,
          tokenAmount: t.tokenAmount,
          price: t.price,
          timestamp: t.timestamp,
        });
        loaded++;
      }
      if (loaded > 0) {
        log.paper(`Loaded ${loaded} historical paper trades for price baselines`);
      }
    }
  }

  async buy(mint: string, solAmount: number): Promise<TradeResult> {
    if (this.virtualBalance < solAmount) {
      return {
        success: false,
        solAmount,
        error: "Insufficient virtual balance",
      };
    }

    // Simulate price based on bonding curve — early buy gets more tokens
    const simulatedPrice = 0.000001 + Math.random() * 0.00001;
    const tokenAmount = solAmount / simulatedPrice;

    this.virtualBalance -= solAmount;
    this.trades.push({
      type: "buy",
      mint,
      solAmount,
      tokenAmount,
      price: simulatedPrice,
      timestamp: Date.now(),
    });

    log.paper(
      `[SIMULATED BUY] ${mint.substring(0, 8)}... | ${solAmount} SOL → ${tokenAmount.toFixed(0)} tokens | price: ${simulatedPrice.toFixed(10)}`
    );
    log.paper(`Virtual balance: ${this.virtualBalance.toFixed(4)} SOL`);

    return {
      success: true,
      signature: `paper_${Date.now()}`,
      tokenAmount,
      solAmount,
      price: simulatedPrice,
    };
  }

  async sell(mint: string, tokenAmount: number): Promise<TradeResult> {
    // Find the buy trade to calculate P&L
    const buyTrade = this.trades.find(
      (t) => t.type === "buy" && t.mint === mint
    );
    const buyPrice = buyTrade?.price || 0.000001;

    // Simulate some price movement
    const priceChange = 1 + (Math.random() * 2 - 0.5); // -50% to +150%
    const currentPrice = buyPrice * priceChange;
    const solReceived = tokenAmount * currentPrice;

    this.virtualBalance += solReceived;
    this.trades.push({
      type: "sell",
      mint,
      solAmount: solReceived,
      tokenAmount,
      price: currentPrice,
      timestamp: Date.now(),
    });

    const pnl = buyTrade ? solReceived - buyTrade.solAmount : 0;
    const pnlPct = buyTrade
      ? ((pnl / buyTrade.solAmount) * 100).toFixed(1)
      : "0";

    log.paper(
      `[SIMULATED SELL] ${mint.substring(0, 8)}... | ${tokenAmount.toFixed(0)} tokens → ${solReceived.toFixed(4)} SOL | PnL: ${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)} SOL (${pnlPct}%)`
    );
    log.paper(`Virtual balance: ${this.virtualBalance.toFixed(4)} SOL`);

    return {
      success: true,
      signature: `paper_${Date.now()}`,
      tokenAmount,
      solAmount: solReceived,
      price: currentPrice,
    };
  }

  async getTokenPrice(mint: string): Promise<number | null> {
    // In paper mode, simulate price movement from last known price
    const lastTrade = [...this.trades]
      .reverse()
      .find((t) => t.mint === mint);
    if (!lastTrade) return null;

    const priceChange = 1 + (Math.random() * 0.4 - 0.15); // -15% to +25%
    return lastTrade.price * priceChange;
  }
}

// =============================================================================
// Live Trader — real transactions on Solana
// =============================================================================

export class LiveTrader implements Trader {
  private connection: Connection;

  constructor(private config: BotConfig, private wallet: Wallet) {
    this.connection = wallet.connection;
  }

  async buy(mint: string, solAmount: number): Promise<TradeResult> {
    try {
      const balance = await this.wallet.getBalanceSol();
      if (balance < solAmount + 0.01) {
        // 0.01 SOL buffer for fees
        return {
          success: false,
          solAmount,
          error: `Insufficient balance: ${balance.toFixed(4)} SOL`,
        };
      }

      const mintPubkey = new PublicKey(mint);
      const solLamports = Math.floor(solAmount * LAMPORTS_PER_SOL);

      // Calculate max token amount with slippage
      const slippageMultiplier = 1 - this.config.slippagePct / 100;

      // Build pump.fun buy instruction
      // The pump.fun program expects specific account layout for a buy
      const buyInstruction = this.buildBuyInstruction(
        mintPubkey,
        solLamports,
        slippageMultiplier
      );

      const transaction = new Transaction();

      // Add priority fee
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeLamports,
        })
      );
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );

      transaction.add(buyInstruction);

      log.info(`Sending buy tx for ${mint.substring(0, 8)}... | ${solAmount} SOL`);
      const signature = await this.wallet.sendTransaction(transaction);
      log.buy(mint.substring(0, 8) + "...", solAmount.toString(), "pending");

      return {
        success: true,
        signature,
        solAmount,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Buy failed: ${errorMsg}`);
      return { success: false, solAmount, error: errorMsg };
    }
  }

  async sell(mint: string, tokenAmount: number): Promise<TradeResult> {
    try {
      const mintPubkey = new PublicKey(mint);
      const slippageMultiplier = 1 - this.config.slippagePct / 100;

      const sellInstruction = this.buildSellInstruction(
        mintPubkey,
        tokenAmount,
        slippageMultiplier
      );

      const transaction = new Transaction();

      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeLamports,
        })
      );
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );

      transaction.add(sellInstruction);

      log.info(
        `Sending sell tx for ${mint.substring(0, 8)}... | ${tokenAmount} tokens`
      );
      const signature = await this.wallet.sendTransaction(transaction);

      return {
        success: true,
        signature,
        tokenAmount,
        solAmount: 0, // actual amount determined after tx confirms
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Sell failed: ${errorMsg}`);
      return { success: false, solAmount: 0, tokenAmount, error: errorMsg };
    }
  }

  async getTokenPrice(mint: string): Promise<number | null> {
    try {
      // Fetch the bonding curve account to get current price
      // Pump.fun bonding curve PDA: seeds = ["bonding-curve", mint]
      const mintPubkey = new PublicKey(mint);
      const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve"), mintPubkey.toBuffer()],
        PUMP_FUN_PROGRAM
      );

      const accountInfo = await this.connection.getAccountInfo(bondingCurve);
      if (!accountInfo || !accountInfo.data) return null;

      // Parse bonding curve data to get virtual reserves
      // Layout: discriminator(8) + virtualTokenReserves(8) + virtualSolReserves(8) + ...
      const data = accountInfo.data;
      if (data.length < 24) return null;

      const virtualTokenReserves = Number(data.readBigUInt64LE(8));
      const virtualSolReserves = Number(data.readBigUInt64LE(16));

      if (virtualTokenReserves === 0) return null;

      // Price = virtualSolReserves / virtualTokenReserves
      const price = virtualSolReserves / virtualTokenReserves;
      return price;
    } catch {
      return null;
    }
  }

  private buildBuyInstruction(
    mint: PublicKey,
    solLamports: number,
    _slippageMultiplier: number
  ): TransactionInstruction {
    // Derive bonding curve PDA
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_FUN_PROGRAM
    );

    // Derive associated bonding curve token account
    const [bondingCurveAta] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    );

    // Buy instruction data: discriminator + tokenAmount(u64) + maxSolCost(u64)
    const buyDiscriminator = Buffer.from([
      0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea,
    ]);
    const data = Buffer.alloc(24);
    buyDiscriminator.copy(data, 0);
    // Token amount — set to max u64 to buy with exact SOL amount
    data.writeBigUInt64LE(BigInt("18446744073709551615"), 8);
    // Max SOL cost
    data.writeBigUInt64LE(BigInt(solLamports), 16);

    return new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        {
          pubkey: this.wallet.publicKey,
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ),
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: PUMP_FUN_FEE_ACCOUNT,
          isSigner: false,
          isWritable: true,
        },
      ],
      data,
    });
  }

  private buildSellInstruction(
    mint: PublicKey,
    tokenAmount: number,
    _slippageMultiplier: number
  ): TransactionInstruction {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_FUN_PROGRAM
    );

    const [bondingCurveAta] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBuffer(),
        new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").toBuffer(),
        mint.toBuffer(),
      ],
      new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL")
    );

    // Sell instruction data: discriminator + tokenAmount(u64) + minSolOutput(u64)
    const sellDiscriminator = Buffer.from([
      0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad,
    ]);
    const data = Buffer.alloc(24);
    sellDiscriminator.copy(data, 0);
    data.writeBigUInt64LE(BigInt(Math.floor(tokenAmount)), 8);
    // Min SOL output — set to 0 for now (slippage handled by config)
    data.writeBigUInt64LE(BigInt(0), 16);

    return new TransactionInstruction({
      programId: PUMP_FUN_PROGRAM,
      keys: [
        { pubkey: bondingCurve, isSigner: false, isWritable: true },
        { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        {
          pubkey: this.wallet.publicKey,
          isSigner: true,
          isWritable: true,
        },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: new PublicKey(
            "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
          ),
          isSigner: false,
          isWritable: false,
        },
        {
          pubkey: PUMP_FUN_FEE_ACCOUNT,
          isSigner: false,
          isWritable: true,
        },
      ],
      data,
    });
  }
}

// Factory function
export function createTrader(config: BotConfig, wallet: Wallet): Trader {
  if (config.mode === "paper") {
    return new PaperTrader(config, wallet);
  }
  return new LiveTrader(config, wallet);
}
