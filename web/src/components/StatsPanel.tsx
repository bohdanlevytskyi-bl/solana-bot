import type { BotStats } from "../hooks/useWebSocket";

interface Props {
  stats: BotStats;
}

export function StatsPanel({ stats }: Props) {
  const pnlClass = stats.totalPnlSol >= 0 ? "positive" : "negative";
  const pnlSign = stats.totalPnlSol >= 0 ? "+" : "";

  return (
    <div className="stats-panel">
      <div className="stat-card">
        <span className="stat-value cyan">{stats.tokensDetected}</span>
        <span className="stat-label">Tokens Seen</span>
      </div>
      <div className="stat-card">
        <span className="stat-value dim">{stats.tokensFiltered}</span>
        <span className="stat-label">Filtered</span>
      </div>
      <div className="stat-card">
        <span className="stat-value green">{stats.tokensSniped}</span>
        <span className="stat-label">Sniped</span>
      </div>
      <div className="stat-card">
        <span className={`stat-value ${pnlClass}`}>
          {pnlSign}{stats.totalPnlSol.toFixed(4)}
        </span>
        <span className="stat-label">P&L (SOL)</span>
      </div>
      <div className="stat-card">
        <span className="stat-value green">{stats.wins}</span>
        <span className="stat-label">Wins</span>
      </div>
      <div className="stat-card">
        <span className="stat-value red">{stats.losses}</span>
        <span className="stat-label">Losses</span>
      </div>
    </div>
  );
}
