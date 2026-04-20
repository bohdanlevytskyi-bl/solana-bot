import Database from "better-sqlite3";
import path from "path";
import { Position } from "./positions";

const DB_PATH = path.join(process.cwd(), "sniper.db");

export class DB {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS positions (
        mint TEXT PRIMARY KEY,
        token_amount REAL NOT NULL,
        buy_price REAL NOT NULL,
        buy_sol_amount REAL NOT NULL,
        buy_timestamp INTEGER NOT NULL,
        signature TEXT,
        name TEXT,
        symbol TEXT
      );

      CREATE TABLE IF NOT EXISTS trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mint TEXT NOT NULL,
        type TEXT NOT NULL,
        sol_amount REAL NOT NULL,
        token_amount REAL NOT NULL,
        price REAL,
        pnl_sol REAL,
        signature TEXT,
        name TEXT,
        symbol TEXT,
        timestamp INTEGER NOT NULL
      );
    `);
  }

  // ---- Positions ----

  savePosition(pos: Position & { name?: string; symbol?: string }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO positions
         (mint, token_amount, buy_price, buy_sol_amount, buy_timestamp, signature, name, symbol)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        pos.mint,
        pos.tokenAmount,
        pos.buyPrice,
        pos.buySolAmount,
        pos.buyTimestamp,
        pos.signature || null,
        pos.name || null,
        pos.symbol || null
      );
  }

  removePosition(mint: string): void {
    this.db.prepare("DELETE FROM positions WHERE mint = ?").run(mint);
  }

  loadPositions(): Array<Position & { name?: string; symbol?: string }> {
    const rows = this.db
      .prepare("SELECT * FROM positions")
      .all() as Array<{
      mint: string;
      token_amount: number;
      buy_price: number;
      buy_sol_amount: number;
      buy_timestamp: number;
      signature: string | null;
      name: string | null;
      symbol: string | null;
    }>;

    return rows.map((row) => ({
      mint: row.mint,
      tokenAmount: row.token_amount,
      buyPrice: row.buy_price,
      buySolAmount: row.buy_sol_amount,
      buyTimestamp: row.buy_timestamp,
      signature: row.signature || undefined,
      name: row.name || undefined,
      symbol: row.symbol || undefined,
    }));
  }

  // ---- Trade History ----

  recordTrade(trade: {
    mint: string;
    type: "buy" | "sell";
    solAmount: number;
    tokenAmount: number;
    price?: number;
    pnlSol?: number;
    signature?: string;
    name?: string;
    symbol?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO trades
         (mint, type, sol_amount, token_amount, price, pnl_sol, signature, name, symbol, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        trade.mint,
        trade.type,
        trade.solAmount,
        trade.tokenAmount,
        trade.price || null,
        trade.pnlSol || null,
        trade.signature || null,
        trade.name || null,
        trade.symbol || null,
        Date.now()
      );
  }

  getTotalPnl(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(pnl_sol), 0) as total FROM trades WHERE type = 'sell'")
      .get() as { total: number };
    return row.total;
  }

  getTradeCount(): { buys: number; sells: number; wins: number; losses: number } {
    const buys = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM trades WHERE type = 'buy'")
        .get() as { count: number }
    ).count;

    const sells = (
      this.db
        .prepare("SELECT COUNT(*) as count FROM trades WHERE type = 'sell'")
        .get() as { count: number }
    ).count;

    const wins = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM trades WHERE type = 'sell' AND pnl_sol >= 0"
        )
        .get() as { count: number }
    ).count;

    const losses = (
      this.db
        .prepare(
          "SELECT COUNT(*) as count FROM trades WHERE type = 'sell' AND pnl_sol < 0"
        )
        .get() as { count: number }
    ).count;

    return { buys, sells, wins, losses };
  }

  getTrades(limit: number = 50, offset: number = 0): Array<{
    id: number;
    mint: string;
    type: string;
    solAmount: number;
    tokenAmount: number;
    price: number | null;
    pnlSol: number | null;
    signature: string | null;
    name: string | null;
    symbol: string | null;
    timestamp: number;
  }> {
    const rows = this.db
      .prepare(
        "SELECT * FROM trades ORDER BY timestamp DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset) as Array<{
      id: number;
      mint: string;
      type: string;
      sol_amount: number;
      token_amount: number;
      price: number | null;
      pnl_sol: number | null;
      signature: string | null;
      name: string | null;
      symbol: string | null;
      timestamp: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      mint: r.mint,
      type: r.type,
      solAmount: r.sol_amount,
      tokenAmount: r.token_amount,
      price: r.price,
      pnlSol: r.pnl_sol,
      signature: r.signature,
      name: r.name,
      symbol: r.symbol,
      timestamp: r.timestamp,
    }));
  }

  close(): void {
    this.db.close();
  }
}
