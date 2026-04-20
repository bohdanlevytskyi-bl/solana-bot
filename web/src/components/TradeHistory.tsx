import { useState, useEffect } from "react";

interface Trade {
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
}

export function TradeHistory() {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    fetch("/api/trades?limit=50")
      .then((r) => r.json())
      .then(setTrades)
      .catch(() => {});

    const interval = setInterval(() => {
      fetch("/api/trades?limit=50")
        .then((r) => r.json())
        .then(setTrades)
        .catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="panel">
      <h2>Trade History ({trades.length})</h2>
      {trades.length === 0 ? (
        <p className="empty">No trades yet</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Token</th>
              <th>SOL</th>
              <th>P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const time = new Date(trade.timestamp).toLocaleTimeString();
              const pnl = trade.pnlSol;
              const pnlClass = pnl !== null ? (pnl >= 0 ? "positive" : "negative") : "";
              return (
                <tr key={trade.id}>
                  <td className="mono">{time}</td>
                  <td className={trade.type === "buy" ? "green" : "magenta"}>
                    {trade.type.toUpperCase()}
                  </td>
                  <td className="token-name">
                    {trade.name || trade.symbol || trade.mint.substring(0, 8) + "..."}
                  </td>
                  <td>{trade.solAmount.toFixed(4)}</td>
                  <td className={pnlClass}>
                    {pnl !== null
                      ? `${pnl >= 0 ? "+" : ""}${pnl.toFixed(4)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
