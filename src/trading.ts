import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { BotConfig } from "./config";
import { Wallet } from "./wallet";
import { log } from "./logger";
import type { DB } from "./db";

// Pump.fun program + well-known PDAs
const PUMP_FUN_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);
const TOKEN_PROGRAM = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_2022_PROGRAM = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);
const GLOBAL_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("global")],
  PUMP_FUN_PROGRAM
)[0];
const EVENT_AUTHORITY_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("__event_authority")],
  PUMP_FUN_PROGRAM
)[0];
const GLOBAL_VOLUME_ACCUMULATOR_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("global_volume_accumulator")],
  PUMP_FUN_PROGRAM
)[0];
const FEE_PROGRAM = new PublicKey(
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"
);
const FEE_CONFIG_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_config"), PUMP_FUN_PROGRAM.toBuffer()],
  FEE_PROGRAM
)[0];

function userVolumeAccumulatorPda(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_volume_accumulator"), user.toBuffer()],
    PUMP_FUN_PROGRAM
  )[0];
}

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
  getAvailableBalance(): Promise<number>;
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
      this.virtualBalance = 0.1;
      log.paper(`Wallet is empty — starting with 0.1 SOL virtual balance for testing`);
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

  async getAvailableBalance(): Promise<number> {
    return this.virtualBalance;
  }
}

// =============================================================================
// Live Trader — real transactions on Solana
// =============================================================================

export class LiveTrader implements Trader {
  // Fetches a recent successful pump.fun sell from chain and logs its exact
  // discriminator, data length, and account count so we can compare with ours.
  async debugReferenceSell(): Promise<void> {
    const SELL_DISC = Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]);
    try {
      const sigs = await this.connection.getSignaturesForAddress(PUMP_FUN_PROGRAM, { limit: 200 });
      for (const sig of sigs) {
        const tx = await this.connection.getParsedTransaction(sig.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (!tx || tx.meta?.err) continue;
        const allIxs = [
          ...tx.transaction.message.instructions,
          ...(tx.meta?.innerInstructions?.flatMap((ii) => ii.instructions) ?? []),
        ];
        for (const ix of allIxs) {
          if (!("data" in ix) || !("programId" in ix)) continue;
          if (!(ix.programId as PublicKey).equals(PUMP_FUN_PROGRAM)) continue;
          let raw: Buffer;
          try {
            const bs58 = await import("bs58");
            raw = Buffer.from(bs58.default.decode(ix.data as string));
          } catch { continue; }
          if (raw.length < 8) continue;
          if (!raw.subarray(0, 8).equals(SELL_DISC)) continue;
          const keys = (ix as any).accounts as PublicKey[] | undefined;
          log.debug(`[REF SELL] tx=${sig.signature.substring(0, 12)}...`);
          log.debug(`[REF SELL] data bytes=${raw.length} hex=${raw.toString("hex")}`);
          log.debug(`[REF SELL] accounts=${keys?.length ?? "?"}`);
          if (keys) keys.forEach((k, i) => log.debug(`[REF SELL]   [${i}] ${k.toBase58()}`));
          return;
        }
      }
      log.debug(`[REF SELL] No recent sell found in last 200 txs`);
    } catch (err) {
      log.debug(`[REF SELL] fetch failed: ${err}`);
    }
  }
  private connection: Connection;
  private cachedFeeRecipient: PublicKey | null = null;

  constructor(private config: BotConfig, private wallet: Wallet) {
    this.connection = wallet.connection;
  }

  private async getMintTokenProgram(mint: PublicKey): Promise<PublicKey | null> {
    const info = await this.connection.getAccountInfo(mint);
    if (!info) return null;
    if (info.owner.equals(TOKEN_PROGRAM)) return TOKEN_PROGRAM;
    if (info.owner.equals(TOKEN_2022_PROGRAM)) return TOKEN_2022_PROGRAM;
    return null;
  }

  private async getFeeRecipient(): Promise<PublicKey> {
    if (this.cachedFeeRecipient) return this.cachedFeeRecipient;
    const info = await this.connection.getAccountInfo(GLOBAL_PDA);
    if (!info || info.data.length < 73) {
      throw new Error("Pump.fun global account not found or malformed");
    }
    // Layout: 8 disc + 1 initialized + 32 authority + 32 feeRecipient
    this.cachedFeeRecipient = new PublicKey(info.data.slice(41, 41 + 32));
    return this.cachedFeeRecipient;
  }

  private async getReserves(mint: PublicKey): Promise<{
    bondingCurve: PublicKey;
    virtualTokenReserves: bigint;
    virtualSolReserves: bigint;
    complete: boolean;
    creator: PublicKey | null;
  } | null> {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from("bonding-curve"), mint.toBuffer()],
      PUMP_FUN_PROGRAM
    );
    const info = await this.connection.getAccountInfo(bondingCurve);
    if (!info || info.data.length < 49) return null;
    // Layout: 8 disc + 8 vtr + 8 vsr + 8 rtr + 8 rsr + 8 supply + 1 complete + 32 creator
    const creator =
      info.data.length >= 81
        ? new PublicKey(info.data.slice(49, 49 + 32))
        : null;
    return {
      bondingCurve,
      virtualTokenReserves: info.data.readBigUInt64LE(8),
      virtualSolReserves: info.data.readBigUInt64LE(16),
      complete: info.data[48] === 1,
      creator,
    };
  }

  private creatorVaultPda(creator: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      PUMP_FUN_PROGRAM
    )[0];
  }

  async buy(mint: string, solAmount: number): Promise<TradeResult> {
    try {
      const balance = await this.wallet.getBalanceSol();
      if (balance < solAmount + 0.01) {
        return {
          success: false,
          solAmount,
          error: `Insufficient balance: ${balance.toFixed(4)} SOL`,
        };
      }

      const mintPk = new PublicKey(mint);
      const solLamports = BigInt(Math.floor(solAmount * LAMPORTS_PER_SOL));

      const tokenProgram = await this.getMintTokenProgram(mintPk);
      if (!tokenProgram) {
        return { success: false, solAmount, error: "Mint not found or unsupported token program" };
      }

      const reserves = await this.getReserves(mintPk);
      if (!reserves) {
        return { success: false, solAmount, error: "Bonding curve not found" };
      }
      if (reserves.complete) {
        return { success: false, solAmount, error: "Token migrated to Raydium" };
      }

      // Estimate token output using fee-adjusted constant-product AMM.
      // Assumes ~2% total protocol+creator fees; used only for minTokensOut floor.
      const slippageBps = BigInt(
        Math.max(0, Math.floor(this.config.slippagePct * 100))
      );
      const feeBps = BigInt(200); // conservative 2% total fee estimate
      const netSol = (solLamports * BigInt(10000)) / (BigInt(10000) + feeBps);
      const k = reserves.virtualTokenReserves * reserves.virtualSolReserves;
      const newSolReserves = reserves.virtualSolReserves + netSol;
      const newTokenReserves = k / newSolReserves;
      const expectedTokens = reserves.virtualTokenReserves - newTokenReserves;
      // Minimum tokens to accept — expected output with slippage tolerance applied
      const minTokensOut =
        (expectedTokens * (BigInt(10000) - slippageBps)) / BigInt(10000);

      log.info(
        `AMM: vtr=${reserves.virtualTokenReserves} vsr=${reserves.virtualSolReserves} ` +
        `netSol=${netSol} expectedTokens=${expectedTokens} minTokensOut=${minTokensOut}`
      );

      const feeRecipient = await this.getFeeRecipient();
      const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [reserves.bondingCurve.toBuffer(), tokenProgram.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );
      const [associatedUser] = PublicKey.findProgramAddressSync(
        [this.wallet.publicKey.toBuffer(), tokenProgram.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // buyExactSolIn: pass SOL amount directly; program computes tokens internally.
      // Disc: [56,252,116,8,158,223,205,95]  args: spendable_sol_in(u64) min_tokens_out(u64) trackVolume(Option<bool>)
      const buyDisc = Buffer.from([56, 252, 116, 8, 158, 223, 205, 95]);
      const data = Buffer.alloc(26);
      buyDisc.copy(data, 0);
      data.writeBigUInt64LE(solLamports, 8);   // spendable_sol_in
      data.writeBigUInt64LE(minTokensOut, 16); // min_tokens_out
      data[24] = 1; // Some(trackVolume)
      data[25] = 1; // trackVolume = true

      const userVolumeAccumulator = userVolumeAccumulatorPda(this.wallet.publicKey);

      if (!reserves.creator) {
        return { success: false, solAmount, error: "Bonding curve missing creator field" };
      }
      const creatorVault = this.creatorVaultPda(reserves.creator);

      const [bondingCurveV2] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve-v2"), mintPk.toBuffer()],
        PUMP_FUN_PROGRAM
      );

      const buyIx = new TransactionInstruction({
        programId: PUMP_FUN_PROGRAM,
        keys: [
          { pubkey: GLOBAL_PDA, isSigner: false, isWritable: false },
          { pubkey: feeRecipient, isSigner: false, isWritable: true },
          { pubkey: mintPk, isSigner: false, isWritable: false },
          { pubkey: reserves.bondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedUser, isSigner: false, isWritable: true },
          { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
          { pubkey: creatorVault, isSigner: false, isWritable: true },
          { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
          { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: GLOBAL_VOLUME_ACCUMULATOR_PDA, isSigner: false, isWritable: false },
          { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
          { pubkey: FEE_CONFIG_PDA, isSigner: false, isWritable: false },
          { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: bondingCurveV2, isSigner: false, isWritable: false },
        ],
        data,
      });

      const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.publicKey,
        associatedUser,
        this.wallet.publicKey,
        mintPk,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM
      );

      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeLamports,
        })
      );
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 })
      );
      transaction.add(ataIx);
      transaction.add(buyIx);

      log.info(`Sending buy tx for ${mint.substring(0, 8)}... | ${solAmount} SOL`);
      const signature = await this.wallet.sendTransaction(transaction);
      log.buy(mint.substring(0, 8) + "...", solAmount.toString(), signature.substring(0, 10));

      const tokensNum = Number(expectedTokens);
      // Use bonding curve spot price (same formula as getTokenPrice) so P&L comparison is consistent
      const pricePerToken = Number(reserves.virtualSolReserves) / Number(reserves.virtualTokenReserves) / LAMPORTS_PER_SOL;

      return {
        success: true,
        signature,
        tokenAmount: tokensNum,
        solAmount,
        price: pricePerToken,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Buy failed: ${errorMsg}`);
      return { success: false, solAmount, error: errorMsg };
    }
  }

  async sell(mint: string, tokenAmount: number): Promise<TradeResult> {
    try {
      const mintPk = new PublicKey(mint);

      const tokenProgram = await this.getMintTokenProgram(mintPk);
      if (!tokenProgram) {
        return {
          success: false,
          solAmount: 0,
          tokenAmount,
          error: "Mint not found or unsupported token program",
        };
      }

      const [associatedUser] = PublicKey.findProgramAddressSync(
        [this.wallet.publicKey.toBuffer(), tokenProgram.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      // Query on-chain token balance (SPL token account layout: amount at offset 64)
      const ataInfo = await this.connection.getAccountInfo(associatedUser);
      if (!ataInfo || ataInfo.data.length < 72) {
        return {
          success: false,
          solAmount: 0,
          tokenAmount,
          error: "Token account not found",
        };
      }
      const onChainTokens = ataInfo.data.readBigUInt64LE(64);
      if (onChainTokens === BigInt(0)) {
        return {
          success: false,
          solAmount: 0,
          tokenAmount,
          error: "Token balance is zero",
        };
      }

      const reserves = await this.getReserves(mintPk);
      if (!reserves) {
        return {
          success: false,
          solAmount: 0,
          tokenAmount,
          error: "Bonding curve not found",
        };
      }
      if (reserves.complete) {
        return {
          success: false,
          solAmount: 0,
          tokenAmount,
          error: "Token migrated to Raydium",
        };
      }

      // Estimate sol_out for return value only (not used as on-chain floor).
      // minSolOutput = 0: pump.fun checks sol_out.checked_sub(min) in u64, which overflows
      // when reserves shift between our read and tx execution making min > actual sol_out.
      const expectedSol =
        (onChainTokens * reserves.virtualSolReserves) /
        (reserves.virtualTokenReserves + onChainTokens);
      const minSolOutput = BigInt(0);

      const feeRecipient = await this.getFeeRecipient();
      const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
        [reserves.bondingCurve.toBuffer(), tokenProgram.toBuffer(), mintPk.toBuffer()],
        ASSOCIATED_TOKEN_PROGRAM
      );

      if (!reserves.creator) {
        return { success: false, solAmount: 0, tokenAmount, error: "Bonding curve missing creator field" };
      }
      const creatorVault = this.creatorVaultPda(reserves.creator);

      // Sell instruction data: discriminator + amount(u64) + minSolOutput(u64)
      const sellDisc = Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]);
      const data = Buffer.alloc(24);
      sellDisc.copy(data, 0);
      data.writeBigUInt64LE(onChainTokens, 8);
      data.writeBigUInt64LE(minSolOutput, 16);

      const userVolumeAccumulator = userVolumeAccumulatorPda(this.wallet.publicKey);

      // Sell account layout (15 accounts) — verified against live pump.fun transactions:
      // 0:global 1:feeRecipient 2:mint 3:bondingCurve 4:associatedBondingCurve
      // 5:associatedUser 6:user 7:system 8:creatorVault 9:tokenProgram
      // 10:eventAuthority 11:pumpProgram 12:feeConfig 13:feeProgram 14:userVolumeAccumulator
      const sellIx = new TransactionInstruction({
        programId: PUMP_FUN_PROGRAM,
        keys: [
          { pubkey: GLOBAL_PDA, isSigner: false, isWritable: false },
          { pubkey: feeRecipient, isSigner: false, isWritable: true },
          { pubkey: mintPk, isSigner: false, isWritable: false },
          { pubkey: reserves.bondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
          { pubkey: associatedUser, isSigner: false, isWritable: true },
          { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: creatorVault, isSigner: false, isWritable: true },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
          { pubkey: EVENT_AUTHORITY_PDA, isSigner: false, isWritable: false },
          { pubkey: PUMP_FUN_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: FEE_CONFIG_PDA, isSigner: false, isWritable: false },
          { pubkey: FEE_PROGRAM, isSigner: false, isWritable: false },
          { pubkey: userVolumeAccumulator, isSigner: false, isWritable: true },
        ],
        data,
      });

      const transaction = new Transaction();
      transaction.add(
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: this.config.priorityFeeLamports,
        })
      );
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );
      transaction.add(sellIx);

      log.info(
        `Sending sell tx for ${mint.substring(0, 8)}... | ${onChainTokens} raw tokens`
      );
      const signature = await this.wallet.sendTransaction(transaction);

      return {
        success: true,
        signature,
        tokenAmount: Number(onChainTokens),
        solAmount: Number(expectedSol) / LAMPORTS_PER_SOL,
        price:
          Number(expectedSol) /
          Number(onChainTokens) /
          LAMPORTS_PER_SOL,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Sell failed: ${errorMsg}`);
      return { success: false, solAmount: 0, tokenAmount, error: errorMsg };
    }
  }

  async getTokenPrice(mint: string): Promise<number | null> {
    try {
      const reserves = await this.getReserves(new PublicKey(mint));
      if (!reserves || reserves.virtualTokenReserves === BigInt(0)) return null;
      return (
        Number(reserves.virtualSolReserves) /
        Number(reserves.virtualTokenReserves) /
        LAMPORTS_PER_SOL
      );
    } catch (err) {
      log.error(`getTokenPrice failed for ${mint.substring(0, 8)}: ${err}`);
      return null;
    }
  }

  async getAvailableBalance(): Promise<number> {
    try {
      return await this.wallet.getBalanceSol();
    } catch {
      return 0;
    }
  }
}

// Factory function
export function createTrader(config: BotConfig, wallet: Wallet): Trader {
  if (config.mode === "paper") {
    return new PaperTrader(config, wallet);
  }
  return new LiveTrader(config, wallet);
}
