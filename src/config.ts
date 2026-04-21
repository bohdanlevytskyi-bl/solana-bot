import dotenv from "dotenv";
dotenv.config();

export type ExecutionMode = "paper" | "production";
export type SnipeMode = "aggressive" | "filtered";
export type ExitBehavior = "keep" | "sell";

export interface BotConfig {
  rpcUrl: string;
  wssUrl: string;
  privateKey: number[];
  mode: ExecutionMode;
  snipeMode: SnipeMode;
  buyAmountSol: number;
  slippagePct: number;
  takeProfitPct: number;
  stopLossPct: number;
  priorityFeeLamports: number;
  exitBehavior: ExitBehavior;
  dashboardPort: number;
  maxSpendSol: number | null;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): BotConfig {
  const mode = (process.env.MODE || "paper") as ExecutionMode;
  if (mode !== "paper" && mode !== "production") {
    throw new Error(`Invalid MODE: "${mode}". Must be "paper" or "production".`);
  }

  const snipeMode = (process.env.SNIPE_MODE || "filtered") as SnipeMode;
  if (snipeMode !== "aggressive" && snipeMode !== "filtered") {
    throw new Error(
      `Invalid SNIPE_MODE: "${snipeMode}". Must be "aggressive" or "filtered".`
    );
  }

  let privateKey: number[];
  try {
    privateKey = JSON.parse(requireEnv("PRIVATE_KEY"));
  } catch {
    throw new Error(
      "PRIVATE_KEY must be a JSON byte array, e.g. [4,23,55,...]"
    );
  }

  const exitBehavior = (process.env.EXIT_BEHAVIOR || "keep") as ExitBehavior;
  if (exitBehavior !== "keep" && exitBehavior !== "sell") {
    throw new Error(
      `Invalid EXIT_BEHAVIOR: "${exitBehavior}". Must be "keep" or "sell".`
    );
  }

  return {
    rpcUrl: requireEnv("RPC_URL"),
    wssUrl: requireEnv("WSS_URL"),
    privateKey,
    mode,
    snipeMode,
    buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL || "0.01"),
    slippagePct: parseFloat(process.env.SLIPPAGE_PCT || "25"),
    takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT || "50"),
    stopLossPct: parseFloat(process.env.STOP_LOSS_PCT || "30"),
    priorityFeeLamports: parseInt(
      process.env.PRIORITY_FEE_LAMPORTS || "100000",
      10
    ),
    exitBehavior,
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || "3001", 10),
    maxSpendSol: (() => {
      const raw = process.env.MAX_SPEND_SOL;
      if (!raw || raw === "") return null;
      const n = parseFloat(raw);
      if (!isFinite(n) || n <= 0) return null;
      return n;
    })(),
  };
}
