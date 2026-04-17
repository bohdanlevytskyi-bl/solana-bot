import { Connection, PublicKey, Logs } from "@solana/web3.js";
import { EventEmitter } from "events";
import bs58 from "bs58";
import { BotConfig } from "./config";
import { log } from "./logger";

// Pump.fun program ID on Solana mainnet
const PUMP_FUN_PROGRAM = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
);


export interface NewTokenEvent {
  mint: string;
  creator: string;
  name: string;
  symbol: string;
  uri: string;
  signature: string;
  timestamp: number;
}

export class PumpFunMonitor extends EventEmitter {
  private connection: Connection;
  private subscriptionId: number | null = null;

  constructor(private config: BotConfig) {
    super();
    this.connection = new Connection(config.rpcUrl, {
      wsEndpoint: config.wssUrl,
      commitment: "confirmed",
    });
  }

  async start(): Promise<void> {
    log.info("Starting pump.fun monitor...");
    log.info(`Watching program: ${PUMP_FUN_PROGRAM.toBase58()}`);

    this.subscriptionId = this.connection.onLogs(
      PUMP_FUN_PROGRAM,
      (logInfo: Logs) => {
        this.handleLog(logInfo);
      },
      "confirmed"
    );

    log.success("Monitor connected — listening for new tokens");
  }

  private async handleLog(logInfo: Logs): Promise<void> {
    try {
      // Look for token creation logs from pump.fun
      const logs = logInfo.logs;
      const isCreate = logs.some(
        (l) => l.includes("Program log: Instruction: Create")
      );

      if (!isCreate) return;

      // Fetch the full transaction to extract token details
      const tx = await this.connection.getParsedTransaction(
        logInfo.signature,
        {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        }
      );

      if (!tx || !tx.meta || tx.meta.err) return;

      const accountKeys = tx.transaction.message.accountKeys;
      if (accountKeys.length < 2) return;

      // In a pump.fun create instruction:
      // Account 0 = creator (signer)
      // Account 1 = mint
      const creator = accountKeys[0].pubkey.toBase58();
      const mint = accountKeys[1].pubkey.toBase58();

      // Extract name, symbol, uri from the create instruction data
      // Pump.fun create instruction layout after 8-byte discriminator:
      //   name: string (4-byte length prefix + utf8)
      //   symbol: string (4-byte length prefix + utf8)
      //   uri: string (4-byte length prefix + utf8)
      let name = "Unknown";
      let symbol = "???";
      let uri = "";

      // Collect all instructions: top-level + inner instructions
      const allInstructions: Array<{ programId: PublicKey; data: string }> = [];

      // Top-level instructions
      for (const ix of tx.transaction.message.instructions) {
        if ("data" in ix && "programId" in ix) {
          allInstructions.push(ix as { programId: PublicKey; data: string });
        }
      }

      // Inner instructions (where pump.fun create often lives)
      if (tx.meta.innerInstructions) {
        for (const inner of tx.meta.innerInstructions) {
          for (const ix of inner.instructions) {
            if ("data" in ix && "programId" in ix) {
              allInstructions.push(
                ix as { programId: PublicKey; data: string }
              );
            }
          }
        }
      }

      // Pump.fun create instruction discriminator: d6 90 4c ec 5f 8b 31 b4
      const PUMP_CREATE_DISC = Buffer.from([0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4]);

      for (const rawIx of allInstructions) {
        if (!rawIx.programId.equals(PUMP_FUN_PROGRAM)) continue;

        try {
          const data = Buffer.from(bs58.decode(rawIx.data));
          if (data.length < 50) continue; // Create instructions are 100+ bytes

          const disc = data.subarray(0, 8);
          if (!disc.equals(PUMP_CREATE_DISC)) continue;

          // Skip 8-byte discriminator
          let offset = 8;

          // Read name (borsh string: u32 length + utf8 bytes)
          if (offset + 4 > data.length) continue;
          const nameLen = data.readUInt32LE(offset);
          offset += 4;
          if (nameLen === 0 || nameLen > 200 || offset + nameLen > data.length)
            continue;
          name = data.subarray(offset, offset + nameLen).toString("utf8");
          offset += nameLen;

          // Read symbol
          if (offset + 4 > data.length) continue;
          const symbolLen = data.readUInt32LE(offset);
          offset += 4;
          if (
            symbolLen === 0 ||
            symbolLen > 200 ||
            offset + symbolLen > data.length
          )
            continue;
          symbol = data.subarray(offset, offset + symbolLen).toString("utf8");
          offset += symbolLen;

          // Read uri
          if (offset + 4 > data.length) continue;
          const uriLen = data.readUInt32LE(offset);
          offset += 4;
          if (offset + uriLen > data.length) continue;
          uri = data.subarray(offset, offset + uriLen).toString("utf8");

          break; // Found the create instruction, stop searching
        } catch {
          // Failed to parse instruction data, try next
        }
      }

      // Only emit if we successfully parsed the create instruction
      if (name === "Unknown" || symbol === "???") return;

      const event: NewTokenEvent = {
        mint,
        creator,
        name,
        symbol,
        uri,
        signature: logInfo.signature,
        timestamp: Date.now(),
      };

      log.newToken(event.name, event.symbol, event.mint);
      this.emit("newToken", event);
    } catch (err) {
      log.error(`Error processing log: ${err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      log.info("Monitor stopped");
    }
  }
}
