export type ActivityType = "NEW" | "BUY" | "SELL" | "FILTERED" | "ERROR" | "INFO";

export interface ActivityEntry {
  time: string;
  type: ActivityType;
  message: string;
}

class Stats {
  tokensDetected = 0;
  tokensFiltered = 0;
  tokensSniped = 0;
  totalPnlSol = 0;
  wins = 0;
  losses = 0;
  startTime = Date.now();

  private activityLog: ActivityEntry[] = [];
  private maxActivity = 15;

  addActivity(type: ActivityType, message: string): void {
    const time = new Date().toISOString().substring(11, 19);
    this.activityLog.push({ time, type, message });
    if (this.activityLog.length > this.maxActivity) {
      this.activityLog.shift();
    }
  }

  getRecentActivity(): ActivityEntry[] {
    return [...this.activityLog];
  }

  recordDetected(name: string, symbol: string, mint: string): void {
    this.tokensDetected++;
    this.addActivity("NEW", `${name} (${symbol}) | ${mint.substring(0, 8)}...`);
  }

  recordFiltered(symbol: string, reason: string): void {
    this.tokensFiltered++;
    this.addActivity("FILTERED", `${symbol}: ${reason}`);
  }

  recordSniped(name: string, symbol: string, solAmount: number): void {
    this.tokensSniped++;
    this.addActivity("BUY", `${name} (${symbol}) | ${solAmount} SOL`);
  }

  recordSell(symbol: string, pnlSol: number): void {
    this.totalPnlSol += pnlSol;
    if (pnlSol >= 0) {
      this.wins++;
    } else {
      this.losses++;
    }
    const sign = pnlSol >= 0 ? "+" : "";
    this.addActivity("SELL", `${symbol} | ${sign}${pnlSol.toFixed(4)} SOL`);
  }

  recordError(message: string): void {
    this.addActivity("ERROR", message);
  }

  getUptime(): string {
    const ms = Date.now() - this.startTime;
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);
    return `${hours}h ${minutes}m ${seconds}s`;
  }
}

// Singleton
export const stats = new Stats();
