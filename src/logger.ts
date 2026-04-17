import { stats } from "./stats";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";
const BOLD = "\x1b[1m";

let dashboardActive = false;

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

export const log = {
  setDashboardMode(active: boolean) {
    dashboardActive = active;
  },

  info(msg: string) {
    if (dashboardActive) {
      stats.addActivity("INFO", msg);
      return;
    }
    console.log(`${GRAY}[${timestamp()}]${RESET} ${BLUE}INFO${RESET}  ${msg}`);
  },

  success(msg: string) {
    if (dashboardActive) {
      stats.addActivity("INFO", msg);
      return;
    }
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${GREEN}OK${RESET}    ${msg}`
    );
  },

  warn(msg: string) {
    if (dashboardActive) {
      stats.addActivity("ERROR", msg);
      return;
    }
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${YELLOW}WARN${RESET}  ${msg}`
    );
  },

  error(msg: string) {
    if (dashboardActive) {
      stats.addActivity("ERROR", msg);
      return;
    }
    console.log(`${GRAY}[${timestamp()}]${RESET} ${RED}ERROR${RESET} ${msg}`);
  },

  buy(token: string, amount: string, price: string) {
    if (dashboardActive) return; // handled via stats.recordSniped
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${GREEN}${BOLD}BUY${RESET}   ${token} | ${amount} SOL | price: ${price}`
    );
  },

  sell(token: string, amount: string, pnl: string) {
    if (dashboardActive) return; // handled via stats.recordSell
    const color = pnl.startsWith("-") ? RED : GREEN;
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${MAGENTA}${BOLD}SELL${RESET}  ${token} | ${amount} SOL | PnL: ${color}${pnl}${RESET}`
    );
  },

  newToken(name: string, symbol: string, mint: string) {
    if (dashboardActive) return; // handled via stats.recordDetected
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${CYAN}NEW${RESET}   ${name} (${symbol}) | ${mint}`
    );
  },

  paper(msg: string) {
    if (dashboardActive) {
      stats.addActivity("INFO", msg);
      return;
    }
    console.log(
      `${GRAY}[${timestamp()}]${RESET} ${YELLOW}PAPER${RESET} ${msg}`
    );
  },

  banner(lines: string[]) {
    if (dashboardActive) return;
    console.log("");
    for (const line of lines) {
      console.log(`  ${BOLD}${line}${RESET}`);
    }
    console.log("");
  },
};
