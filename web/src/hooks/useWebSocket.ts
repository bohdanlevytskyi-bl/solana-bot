import { useState, useEffect, useRef, useCallback } from "react";

export interface Position {
  mint: string;
  tokenAmount: number;
  buyPrice: number;
  buySolAmount: number;
  buyTimestamp: number;
  signature?: string;
  name?: string;
  symbol?: string;
}

export interface ActivityEntry {
  time: string;
  type: "NEW" | "BUY" | "SELL" | "FILTERED" | "ERROR" | "INFO";
  message: string;
}

export interface BotStats {
  tokensDetected: number;
  tokensFiltered: number;
  tokensSniped: number;
  totalPnlSol: number;
  wins: number;
  losses: number;
  uptime: string;
}

export interface BotConfig {
  mode: string;
  snipeMode: string;
  buyAmountSol: number;
  takeProfitPct: number;
  stopLossPct: number;
}

export interface BotState {
  stats: BotStats;
  positions: Position[];
  balance: number;
  activity: ActivityEntry[];
  config: BotConfig;
  connected: boolean;
}

const defaultState: BotState = {
  stats: {
    tokensDetected: 0,
    tokensFiltered: 0,
    tokensSniped: 0,
    totalPnlSol: 0,
    wins: 0,
    losses: 0,
    uptime: "0h 0m 0s",
  },
  positions: [],
  balance: 0,
  activity: [],
  config: {
    mode: "paper",
    snipeMode: "filtered",
    buyAmountSol: 0.01,
    takeProfitPct: 50,
    stopLossPct: 30,
  },
  connected: false,
};

export function useWebSocket(): BotState {
  const [state, setState] = useState<BotState>(defaultState);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setState((prev) => ({
          ...prev,
          ...data,
          connected: true,
        }));
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return state;
}
