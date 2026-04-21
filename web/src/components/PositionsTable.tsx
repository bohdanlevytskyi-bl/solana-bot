import { useState } from "react";
import type { Position } from "../hooks/useWebSocket";

interface Props {
  positions: Position[];
}

function formatAge(timestamp: number): string {
  const ms = Date.now() - timestamp;
  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / 60000) % 60;
  const hours = Math.floor(ms / 3600000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function PositionsTable({ positions }: Props) {
  const [selling, setSelling] = useState<Set<string>>(new Set());

  async function handleSell(mint: string) {
    if (selling.has(mint)) return;
    if (!confirm("Sell this position now?")) return;

    setSelling((prev) => new Set(prev).add(mint));
    try {
      const res = await fetch(`/api/positions/${mint}/sell`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(`Sell failed: ${body.error || res.statusText}`);
      }
    } catch (err) {
      alert(`Sell failed: ${err}`);
    } finally {
      setSelling((prev) => {
        const next = new Set(prev);
        next.delete(mint);
        return next;
      });
    }
  }

  return (
    <div className="panel">
      <h2>Open Positions ({positions.length})</h2>
      {positions.length === 0 ? (
        <p className="empty">No open positions</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Mint</th>
              <th>Tokens</th>
              <th>Buy Price</th>
              <th>Current</th>
              <th>P&L</th>
              <th>Value</th>
              <th>Age</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const current = pos.currentPrice;
              const hasPrice = typeof current === "number" && current > 0;
              const pnlSol = hasPrice
                ? current * pos.tokenAmount - pos.buySolAmount
                : null;
              const pnlPct = hasPrice
                ? ((current - pos.buyPrice) / pos.buyPrice) * 100
                : null;
              const currentValue = hasPrice
                ? current * pos.tokenAmount
                : null;
              const pnlClass =
                pnlSol === null ? "dim" : pnlSol >= 0 ? "positive" : "negative";
              const isSelling = selling.has(pos.mint);

              return (
                <tr key={pos.mint}>
                  <td className="token-name">{pos.name || pos.symbol || "???"}</td>
                  <td className="mono">{pos.mint.substring(0, 8)}...</td>
                  <td>{pos.tokenAmount.toFixed(0)}</td>
                  <td className="mono">{pos.buyPrice.toFixed(10)}</td>
                  <td className="mono">
                    {hasPrice ? current.toFixed(10) : "…"}
                  </td>
                  <td className={pnlClass}>
                    {pnlSol === null
                      ? "…"
                      : `${pnlSol >= 0 ? "+" : ""}${pnlSol.toFixed(4)} SOL (${
                          pnlPct! >= 0 ? "+" : ""
                        }${pnlPct!.toFixed(1)}%)`}
                  </td>
                  <td>
                    {currentValue === null
                      ? "…"
                      : `${currentValue.toFixed(4)} SOL`}
                  </td>
                  <td>{formatAge(pos.buyTimestamp)}</td>
                  <td>
                    <button
                      className="sell-btn"
                      onClick={() => handleSell(pos.mint)}
                      disabled={isSelling}
                    >
                      {isSelling ? "Selling…" : "Sell"}
                    </button>
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
