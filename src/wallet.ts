import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
  SendOptions,
} from "@solana/web3.js";
import { BotConfig } from "./config";
import { log } from "./logger";

export class Wallet {
  public readonly keypair: Keypair;
  public readonly connection: Connection;

  constructor(private config: BotConfig) {
    this.keypair = Keypair.fromSecretKey(Uint8Array.from(config.privateKey));
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  get publicKey() {
    return this.keypair.publicKey;
  }

  async getBalanceSol(): Promise<number> {
    const lamports = await this.connection.getBalance(this.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  async sendTransaction(
    transaction: Transaction,
    options?: SendOptions
  ): Promise<string> {
    transaction.feePayer = this.publicKey;
    const latestBlockhash = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair],
      {
        commitment: "confirmed",
        ...options,
      }
    );

    return signature;
  }

  async printBalance(): Promise<void> {
    const balance = await this.getBalanceSol();
    log.info(`Wallet: ${this.publicKey.toBase58()}`);
    log.info(`Balance: ${balance.toFixed(4)} SOL`);

    if (this.config.mode === "production" && balance < this.config.buyAmountSol) {
      log.warn(
        `Balance (${balance.toFixed(4)} SOL) is less than buy amount (${this.config.buyAmountSol} SOL)!`
      );
    }
  }
}
