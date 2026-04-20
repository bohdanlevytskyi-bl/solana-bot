import type { BotConfig } from "../hooks/useWebSocket";

interface Props {
  config: BotConfig;
  uptime: string;
  balance: number;
  connected: boolean;
}

export function Header({ config, uptime, balance, connected }: Props) {
  return (
    <header className="header">
      <div className="header-left">
        <h1>Pump.fun Sniper Bot</h1>
        <div className="badges">
          <span className={`badge ${config.mode === "paper" ? "badge-yellow" : "badge-red"}`}>
            {config.mode.toUpperCase()}
          </span>
          <span className={`badge ${config.snipeMode === "filtered" ? "badge-green" : "badge-red"}`}>
            {config.snipeMode.toUpperCase()}
          </span>
          <span className={`badge ${connected ? "badge-green" : "badge-red"}`}>
            {connected ? "CONNECTED" : "DISCONNECTED"}
          </span>
        </div>
      </div>
      <div className="header-right">
        <div className="header-stat">
          <span className="label">Balance</span>
          <span className="value">{balance.toFixed(4)} SOL</span>
        </div>
        <div className="header-stat">
          <span className="label">Uptime</span>
          <span className="value">{uptime}</span>
        </div>
      </div>
    </header>
  );
}
