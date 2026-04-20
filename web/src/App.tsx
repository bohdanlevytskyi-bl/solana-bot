import { useWebSocket } from "./hooks/useWebSocket";
import { Header } from "./components/Header";
import { StatsPanel } from "./components/StatsPanel";
import { PositionsTable } from "./components/PositionsTable";
import { ActivityFeed } from "./components/ActivityFeed";
import { TradeHistory } from "./components/TradeHistory";
import "./App.css";

function App() {
  const state = useWebSocket();

  return (
    <div className="app">
      <Header
        config={state.config}
        uptime={state.stats.uptime}
        balance={state.balance}
        connected={state.connected}
      />
      <StatsPanel stats={state.stats} />
      <div className="grid">
        <PositionsTable positions={state.positions} />
        <ActivityFeed activity={state.activity} />
      </div>
      <TradeHistory />
    </div>
  );
}

export default App;
