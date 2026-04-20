import type { ActivityEntry } from "../hooks/useWebSocket";

interface Props {
  activity: ActivityEntry[];
}

const typeColors: Record<string, string> = {
  NEW: "cyan",
  BUY: "green",
  SELL: "magenta",
  FILTERED: "dim",
  ERROR: "red",
  INFO: "blue",
};

export function ActivityFeed({ activity }: Props) {
  const reversed = [...activity].reverse();

  return (
    <div className="panel">
      <h2>Recent Activity</h2>
      {reversed.length === 0 ? (
        <p className="empty">Waiting for tokens...</p>
      ) : (
        <div className="activity-list">
          {reversed.map((entry, i) => (
            <div key={i} className="activity-row">
              <span className="activity-time">{entry.time}</span>
              <span className={`activity-type ${typeColors[entry.type] || ""}`}>
                {entry.type}
              </span>
              <span className="activity-msg">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
