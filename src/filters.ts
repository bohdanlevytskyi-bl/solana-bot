import { Connection, PublicKey } from "@solana/web3.js";
import { BotConfig } from "./config";
import { NewTokenEvent } from "./monitor";
import { log } from "./logger";

export interface FilterResult {
  passed: boolean;
  reason?: string;
}

export class TokenFilter {
  private connection: Connection;

  constructor(private config: BotConfig) {
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  async apply(token: NewTokenEvent): Promise<FilterResult> {
    // In aggressive mode, skip all filters
    if (this.config.snipeMode === "aggressive") {
      return { passed: true };
    }

    // Filter 1: Must have a name and symbol
    if (!token.name || token.name === "Unknown") {
      return { passed: false, reason: "Missing token name" };
    }
    if (!token.symbol || token.symbol === "???") {
      return { passed: false, reason: "Missing token symbol" };
    }

    // Filter 2: Must have metadata URI
    if (!token.uri || token.uri === "") {
      return { passed: false, reason: "Missing metadata URI" };
    }

    // Filter 3: Check creator wallet — skip if creator has too many recent token launches
    // (possible serial rugger)
    const creatorCheck = await this.checkCreator(token.creator);
    if (!creatorCheck.passed) {
      return creatorCheck;
    }

    return { passed: true };
  }

  private async checkCreator(creator: string): Promise<FilterResult> {
    try {
      const pubkey = new PublicKey(creator);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit: 20,
      });

      // If creator has launched many transactions recently, they might be a serial deployer
      const recentCount = signatures.filter((s) => {
        const age = Date.now() / 1000 - (s.blockTime || 0);
        return age < 3600; // last hour
      }).length;

      if (recentCount > 10) {
        return {
          passed: false,
          reason: `Creator has ${recentCount} txns in last hour (possible serial deployer)`,
        };
      }

      return { passed: true };
    } catch (err) {
      log.warn(`Creator check failed: ${err}`);
      // Don't block on filter errors — let it through
      return { passed: true };
    }
  }
}
