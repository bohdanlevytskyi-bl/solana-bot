import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import path from "path";
import { BotConfig } from "./config";
import { PositionManager } from "./positions";
import { Wallet } from "./wallet";
import { DB } from "./db";
import { stats } from "./stats";
import { log } from "./logger";

export interface ApiDeps {
  config: BotConfig;
  positionManager: PositionManager;
  wallet: Wallet;
  db: DB;
}

export function startApiServer(deps: ApiDeps): http.Server {
  const { config, positionManager, wallet, db } = deps;
  const app = express();
  const server = http.createServer(app);

  // WebSocket server
  const wss = new WebSocketServer({ server, path: "/ws" });

  app.use(express.json());

  // Serve built frontend
  const webDist = path.join(process.cwd(), "web", "dist");
  app.use(express.static(webDist));

  // REST API
  app.get("/api/status", (_req, res) => {
    res.json({
      mode: config.mode,
      snipeMode: config.snipeMode,
      buyAmountSol: config.buyAmountSol,
      slippagePct: config.slippagePct,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      exitBehavior: config.exitBehavior,
      uptime: stats.getUptime(),
    });
  });

  app.get("/api/stats", (_req, res) => {
    res.json({
      tokensDetected: stats.tokensDetected,
      tokensFiltered: stats.tokensFiltered,
      tokensSniped: stats.tokensSniped,
      totalPnlSol: stats.totalPnlSol,
      wins: stats.wins,
      losses: stats.losses,
      uptime: stats.getUptime(),
    });
  });

  app.get("/api/positions", (_req, res) => {
    res.json(positionManager.getOpenPositions());
  });

  app.post("/api/positions/:mint/sell", async (req, res) => {
    const { mint } = req.params;
    const result = await positionManager.sellPosition(mint);
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  });

  app.get("/api/balance", async (_req, res) => {
    try {
      const balance = await wallet.getBalanceSol();
      res.json({ balance });
    } catch {
      res.json({ balance: 0 });
    }
  });

  app.get("/api/trades", (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const trades = db.getTrades(limit, offset);
    res.json(trades);
  });

  app.get("/api/activity", (_req, res) => {
    res.json(stats.getRecentActivity());
  });

  // Fallback to index.html for SPA routing
  app.use((_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  // WebSocket: push updates every 2 seconds
  let wsInterval: ReturnType<typeof setInterval> | null = null;

  wss.on("connection", (ws: WebSocket) => {
    // Send initial state immediately
    sendUpdate(ws);
  });

  async function buildUpdate() {
    let balance = 0;
    try {
      balance = await wallet.getBalanceSol();
    } catch {
      // keep 0
    }

    return {
      stats: {
        tokensDetected: stats.tokensDetected,
        tokensFiltered: stats.tokensFiltered,
        tokensSniped: stats.tokensSniped,
        totalPnlSol: stats.totalPnlSol,
        wins: stats.wins,
        losses: stats.losses,
        uptime: stats.getUptime(),
      },
      positions: positionManager.getOpenPositions(),
      balance,
      activity: stats.getRecentActivity(),
      config: {
        mode: config.mode,
        snipeMode: config.snipeMode,
        buyAmountSol: config.buyAmountSol,
        takeProfitPct: config.takeProfitPct,
        stopLossPct: config.stopLossPct,
      },
    };
  }

  async function sendUpdate(ws: WebSocket) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      const data = await buildUpdate();
      ws.send(JSON.stringify(data));
    } catch {
      // ignore send errors
    }
  }

  async function broadcastUpdate() {
    const data = await buildUpdate();
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  }

  wsInterval = setInterval(broadcastUpdate, 2000);

  const port = config.dashboardPort;
  server.listen(port, () => {
    log.info(`Dashboard running at http://localhost:${port}`);
  });

  // Cleanup on server close
  server.on("close", () => {
    if (wsInterval) clearInterval(wsInterval);
    wss.close();
  });

  return server;
}
