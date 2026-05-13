import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

const RPC_URL = "https://mainnet.helius-rpc.com/?api-key=9fdd52ac-b1e7-401c-9b4b-f2859ab4e978";
const PUMP_FUN_PROGRAM = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const SELL_DISC = Buffer.from([0x33, 0xe6, 0x85, 0xa4, 0x01, 0x7f, 0x83, 0xad]);

// Known PDAs
const FEE_CONFIG_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("fee_config"), PUMP_FUN_PROGRAM.toBuffer()],
  FEE_PROGRAM
)[0];
const GLOBAL_VOLUME_ACCUMULATOR_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from("global_volume_accumulator")],
  PUMP_FUN_PROGRAM
)[0];

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");

  console.log("\n=== KNOWN PDAs ===");
  console.log(`FEE_CONFIG_PDA:                  ${FEE_CONFIG_PDA.toBase58()}`);
  console.log(`GLOBAL_VOLUME_ACCUMULATOR_PDA:   ${GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58()}`);

  // Reference sell: find 3 different sells to compare account[12] and [14]
  console.log("\nFetching recent pump.fun transactions...");
  const sigs = await conn.getSignaturesForAddress(PUMP_FUN_PROGRAM, { limit: 300 });
  let found = 0;

  for (const sig of sigs) {
    if (found >= 3) break;
    const tx = await conn.getParsedTransaction(sig.signature, {
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
      try { raw = Buffer.from(bs58.decode(ix.data as string)); } catch { continue; }
      if (raw.length < 8 || !raw.subarray(0, 8).equals(SELL_DISC)) continue;

      const keys = (ix as any).accounts as PublicKey[];
      if (!keys || keys.length < 15) continue;

      const mint = keys[2];
      const user = keys[6];

      const [bondingCurveV2] = PublicKey.findProgramAddressSync(
        [Buffer.from("bonding-curve-v2"), mint.toBuffer()],
        PUMP_FUN_PROGRAM
      );
      const [userVolAcc] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_volume_accumulator"), user.toBuffer()],
        PUMP_FUN_PROGRAM
      );

      found++;
      console.log(`\n--- SELL #${found}: ${sig.signature.substring(0, 16)}... ---`);
      console.log(`  mint:         ${mint.toBase58()}`);
      console.log(`  user:         ${user.toBase58()}`);
      console.log(`  acct[12]:     ${keys[12].toBase58()}`);
      console.log(`  acct[13]:     ${keys[13].toBase58()}`);
      console.log(`  acct[14]:     ${keys[14] ? keys[14].toBase58() : "(none)"}`);
      console.log(`  feeConfigPDA: ${FEE_CONFIG_PDA.toBase58()}`);
      console.log(`  globalVolAcc: ${GLOBAL_VOLUME_ACCUMULATOR_PDA.toBase58()}`);
      console.log(`  bondCurveV2:  ${bondingCurveV2.toBase58()}`);
      console.log(`  userVolAcc:   ${userVolAcc.toBase58()}`);
      console.log(`  acct[12] == feeConfig?    ${keys[12].equals(FEE_CONFIG_PDA)}`);
      console.log(`  acct[12] == userVolAcc?   ${keys[12].equals(userVolAcc)}`);
      console.log(`  acct[14] == bondCurveV2?  ${keys[14]?.equals(bondingCurveV2) ?? false}`);
      console.log(`  acct[14] == globalVolAcc? ${keys[14]?.equals(GLOBAL_VOLUME_ACCUMULATOR_PDA) ?? false}`);
      break;
    }
  }
}

main().catch(console.error);
