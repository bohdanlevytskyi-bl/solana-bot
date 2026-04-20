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
              <th>Cost</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => (
              <tr key={pos.mint}>
                <td className="token-name">{pos.name || pos.symbol || "???"}</td>
                <td className="mono">{pos.mint.substring(0, 8)}...</td>
                <td>{pos.tokenAmount.toFixed(0)}</td>
                <td className="mono">{pos.buyPrice.toFixed(10)}</td>
                <td>{pos.buySolAmount.toFixed(4)} SOL</td>
                <td>{formatAge(pos.buyTimestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
