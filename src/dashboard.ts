import { BotConfig } from "./config";
import { Position } from "./positions";
import { stats, ActivityType } from "./stats";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const WHITE = "\x1b[37m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

const W = 66; // dashboard width

function pad(str: string, len: number): string {
  // Strip ANSI codes for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
  if (stripped.length >= len) return str;
  return str + " ".repeat(len - stripped.length);
}

function line(content: string): string {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, "");
  const padding = Math.max(0, W - 4 - stripped.length);
  return `${DIM}║${RESET} ${content}${" ".repeat(padding)} ${DIM}║${RESET}`;
}

function divider(): string {
  return `${DIM}╠${"═".repeat(W - 2)}╣${RESET}`;
}

function topBorder(): string {
  return `${DIM}╔${"═".repeat(W - 2)}╗${RESET}`;
}

function bottomBorder(): string {
  return `${DIM}╚${"═".repeat(W - 2)}╝${RESET}`;
}

const TYPE_COLORS: Record<ActivityType, string> = {
  NEW: CYAN,
  BUY: GREEN,
  SELL: MAGENTA,
  FILTERED: GRAY,
  ERROR: RED,
  INFO: BLUE,
};

export class Dashboard {
  private interval: ReturnType<typeof setInterval> | null = null;
  private getPositions: () => Position[];
  private getBalance: () => Promise<number>;
  private currentBalance = 0;

  constructor(
    private config: BotConfig,
    positionGetter: () => Position[],
    balanceGetter: () => Promise<number>
  ) {
    this.getPositions = positionGetter;
    this.getBalance = balanceGetter;
  }

  async start(): Promise<void> {
    this.currentBalance = await this.getBalance();
    this.render();

    this.interval = setInterval(async () => {
      try {
        this.currentBalance = await this.getBalance();
      } catch {
        // keep last known balance
      }
      this.render();
    }, 2000);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private render(): void {
    const output: string[] = [];

    // Clear screen and move cursor to top
    output.push("\x1b[2J\x1b[H");

    // Header
    const modeStr = this.config.mode === "paper"
      ? `${YELLOW}PAPER${RESET}`
      : `${RED}${BOLD}PRODUCTION${RESET}`;
    const snipeStr = this.config.snipeMode === "aggressive"
      ? `${RED}AGGRESSIVE${RESET}`
      : `${GREEN}FILTERED${RESET}`;

    output.push(topBorder());
    output.push(line(
      `${BOLD}Pump.fun Sniper Bot v1.0.0${RESET}        ${modeStr} ${DIM}|${RESET} ${snipeStr}`
    ));
    output.push(line(
      `${DIM}Uptime: ${stats.getUptime()}${RESET}` +
      `     ${DIM}Balance:${RESET} ${BOLD}${this.currentBalance.toFixed(4)} SOL${RESET}`
    ));

    // Stats section
    output.push(divider());
    output.push(line(`${BOLD}${WHITE}STATS${RESET}`));
    output.push(line(
      `Seen: ${CYAN}${stats.tokensDetected}${RESET}` +
      `    Filtered: ${GRAY}${stats.tokensFiltered}${RESET}` +
      `    Sniped: ${GREEN}${stats.tokensSniped}${RESET}`
    ));

    const pnlColor = stats.totalPnlSol >= 0 ? GREEN : RED;
    const pnlSign = stats.totalPnlSol >= 0 ? "+" : "";
    output.push(line(
      `P&L: ${pnlColor}${BOLD}${pnlSign}${stats.totalPnlSol.toFixed(4)} SOL${RESET}` +
      `    Wins: ${GREEN}${stats.wins}${RESET}` +
      `    Losses: ${RED}${stats.losses}${RESET}`
    ));

    // Open Positions
    const positions = this.getPositions();
    output.push(divider());
    output.push(line(`${BOLD}${WHITE}OPEN POSITIONS (${positions.length})${RESET}`));

    if (positions.length === 0) {
      output.push(line(`${DIM}No open positions${RESET}`));
    } else {
      output.push(line(
        `${DIM}${pad("Mint", 12)} ${pad("Tokens", 10)} ${pad("Buy Price", 14)} ${pad("Cost", 8)}${RESET}`
      ));
      for (const pos of positions.slice(0, 5)) {
        const mint = pos.mint.substring(0, 10) + "..";
        const tokens = pos.tokenAmount.toFixed(0);
        const price = pos.buyPrice.toFixed(10);
        const cost = pos.buySolAmount.toFixed(4);
        output.push(line(
          `${pad(mint, 12)} ${pad(tokens, 10)} ${pad(price, 14)} ${pad(cost, 8)}`
        ));
      }
      if (positions.length > 5) {
        output.push(line(`${DIM}... and ${positions.length - 5} more${RESET}`));
      }
    }

    // Recent Activity
    const activity = stats.getRecentActivity();
    output.push(divider());
    output.push(line(`${BOLD}${WHITE}RECENT ACTIVITY${RESET}`));

    if (activity.length === 0) {
      output.push(line(`${DIM}Waiting for tokens...${RESET}`));
    } else {
      const shown = activity.slice(-10).reverse();
      for (const entry of shown) {
        const color = TYPE_COLORS[entry.type] || WHITE;
        const typeLabel = pad(entry.type, 8);
        const msg = entry.message.length > 42
          ? entry.message.substring(0, 42) + "..."
          : entry.message;
        output.push(line(
          `${DIM}${entry.time}${RESET} ${color}${typeLabel}${RESET} ${msg}`
        ));
      }
    }

    output.push(bottomBorder());
    output.push(`${DIM}Press Ctrl+C to stop${RESET}`);

    process.stdout.write(output.join("\n") + "\n");
  }
}
