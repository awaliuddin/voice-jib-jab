/**
 * Main Application Component
 * Voice Jib-Jab Client
 */

import React, { useEffect, useState } from "react";
import {
  SessionManager,
  SessionState,
  LatencyMetrics,
  LaneInfo,
} from "./state/SessionManager";
import { TalkButton } from "./ui/TalkButton";
import { DebugOverlay } from "./ui/DebugOverlay";
import "./App.css";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3000";

function App() {
  const [sessionManager] = useState(() => new SessionManager(WS_URL));
  const [state, setState] = useState<SessionState>("idle");
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    ttfb: null,
    turnLatency: null,
    bargeInStop: null,
  });
  const [showDebug, setShowDebug] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [laneInfo, setLaneInfo] = useState<LaneInfo>({
    owner: "none",
    state: "IDLE",
  });

  useEffect(() => {
    // Setup callbacks
    sessionManager.setOnStateChange((newState) => {
      setState(newState);
      // Clear error when successfully connected
      if (newState === "connected") {
        setError(null);
      }
    });

    sessionManager.setOnMetricsUpdate((newMetrics) => {
      setMetrics(newMetrics);
    });

    sessionManager.setOnLaneChange((newLaneInfo) => {
      setLaneInfo(newLaneInfo);
    });

    // Auto-initialize on mount with small delay for DOM stability
    const initTimer = setTimeout(() => {
      handleConnect();
    }, 100);

    // Cleanup on unmount
    return () => {
      clearTimeout(initTimer);
      sessionManager.disconnect();
    };
  }, [sessionManager]);

  const handleConnect = async () => {
    try {
      setError(null);
      await sessionManager.initialize();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect";
      setError(message);
      console.error("Connection error:", err);
    }
  };

  const handleTalkPress = () => {
    sessionManager.startTalking();
  };

  const handleTalkRelease = () => {
    sessionManager.stopTalking();
  };

  const handleBargeIn = () => {
    sessionManager.bargeIn();
  };

  const handleEndCall = () => {
    sessionManager.disconnect();
    setState("idle");
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="app-title__icon">🎙️</span>
          Voice Jib-Jab
        </h1>
        <p className="app-subtitle">NextGen AI Voice Orchestrator</p>
      </header>

      <main className="app-main">
        {error && (
          <div className="error-banner">
            <span className="error-banner__icon">⚠️</span>
            <span className="error-banner__text">{error}</span>
            <button className="error-banner__retry" onClick={handleConnect}>
              Retry
            </button>
          </div>
        )}

        <TalkButton
          state={state}
          isAudioPlaying={sessionManager.isAudioPlaying()}
          onPress={handleTalkPress}
          onRelease={handleTalkRelease}
          onBargeIn={handleBargeIn}
        />

        <div className="app-controls">
          {state !== "idle" && (
            <button
              className="app-controls__button app-controls__button--end"
              onClick={handleEndCall}
            >
              End Call
            </button>
          )}
          <button
            className="app-controls__button"
            onClick={() => setShowDebug(!showDebug)}
          >
            {showDebug ? "Hide Debug" : "Show Debug"}
          </button>
        </div>
      </main>

      <DebugOverlay
        state={state}
        metrics={metrics}
        laneInfo={laneInfo}
        isVisible={showDebug}
      />

      <footer className="app-footer">
        <p>Built with NXTG-Forge • Lane-based Architecture</p>
      </footer>
    </div>
  );
}

export default App;
