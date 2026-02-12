/**
 * Main Application Component
 * Voice Jib-Jab - Enterprise Voice AI Infrastructure
 */

import { useEffect, useState } from "react";
import {
  SessionManager,
  SessionState,
  LatencyMetrics,
  LaneInfo,
  VoiceMode,
} from "./state/SessionManager";
import { Navigation } from "./components/Navigation";
import { VoiceInterface } from "./components/VoiceInterface";
import { PerformanceShowcase } from "./components/PerformanceShowcase";
import { TrustSignals } from "./components/TrustSignals";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:3000";

function App() {
  const [sessionManager] = useState(() => new SessionManager(WS_URL));
  const [state, setState] = useState<SessionState>("idle");
  const [metrics, setMetrics] = useState<LatencyMetrics>({
    ttfb: null,
    turnLatency: null,
    bargeInStop: null,
  });
  const [showMetrics, setShowMetrics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [laneInfo, setLaneInfo] = useState<LaneInfo>({
    owner: "none",
    state: "IDLE",
  });
  const [voiceMode, setVoiceMode] = useState<VoiceMode>("push-to-talk");
  const [openMicActive, setOpenMicActive] = useState(false);

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

    sessionManager.setOnVoiceModeChange((newMode) => {
      setVoiceMode(newMode);
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
    setOpenMicActive(false);
  };

  const handleToggleVoiceMode = () => {
    sessionManager.toggleVoiceMode();
  };

  const handleToggleOpenMic = async () => {
    if (sessionManager.isOpenMicActive()) {
      sessionManager.stopOpenMic();
      setOpenMicActive(false);
    } else {
      await sessionManager.startOpenMic();
      setOpenMicActive(sessionManager.isOpenMicActive());
    }
  };

  return (
    <div className="min-h-screen bg-surface-900">
      <Navigation />

      {/* Hero Section */}
      <section className="relative overflow-hidden">
        {/* Ambient background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900/20 via-surface-900 to-surface-950" />

        {/* Animated grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(74,108,247,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(74,108,247,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_50%,black,transparent)]" />

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-24 pb-16">
          {/* Trust badge */}
          <div className="flex justify-center mb-8 animate-fade-in">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-850/50 border border-brand-500/20 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-success-500"></span>
              </span>
              <span className="text-sm font-medium text-surface-300">
                99.99% uptime • Sub-400ms latency • SOC 2 Type II
              </span>
            </div>
          </div>

          {/* Hero headline */}
          <h1 className="text-center text-5xl lg:text-7xl font-bold text-white mb-6 tracking-tight animate-slide-up">
            Enterprise Voice AI
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-brand-400 via-brand-500 to-brand-600">
              at Machine Speed
            </span>
          </h1>

          {/* Value proposition */}
          <p className="text-center text-lg lg:text-xl text-surface-400 max-w-3xl mx-auto mb-12 leading-relaxed">
            Production-ready voice infrastructure with{" "}
            <strong className="text-white font-semibold">
              sub-400ms time-to-first-byte
            </strong>
            . Lane-based architecture eliminates feedback loops. Persistent
            memory maintains context across sessions.
          </p>

          {/* Error banner */}
          {error && (
            <div className="max-w-2xl mx-auto mb-8 bg-error-500/10 border border-error-500/30 rounded-xl p-4 animate-slide-down">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⚠️</span>
                <span className="flex-1 text-error-500">{error}</span>
                <button
                  onClick={handleConnect}
                  className="px-4 py-2 bg-error-500 hover:bg-error-600 text-white text-sm font-semibold rounded-lg transition-all"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Voice Interface */}
          <VoiceInterface
            state={state}
            isAudioPlaying={sessionManager.isAudioPlaying()}
            voiceMode={voiceMode}
            openMicActive={openMicActive}
            onPress={handleTalkPress}
            onRelease={handleTalkRelease}
            onBargeIn={handleBargeIn}
            onToggleOpenMic={handleToggleOpenMic}
            onToggleVoiceMode={handleToggleVoiceMode}
          />

          {/* Controls */}
          {state !== "idle" && (
            <div className="flex justify-center gap-4 mt-12">
              <button
                onClick={handleEndCall}
                className="px-6 py-3 bg-error-500/10 border border-error-500/30 text-error-500 hover:bg-error-500/20 font-medium rounded-lg transition-all"
              >
                End Call
              </button>
              <button
                onClick={() => setShowMetrics(!showMetrics)}
                className="px-6 py-3 bg-surface-850 border border-surface-700 text-surface-300 hover:text-white hover:border-surface-600 font-medium rounded-lg transition-all"
              >
                {showMetrics ? "Hide Metrics" : "Show Metrics"}
              </button>
            </div>
          )}

          {/* Performance Showcase */}
          {showMetrics && state !== "idle" && (
            <div className="mt-16">
              <PerformanceShowcase
                metrics={metrics}
                laneInfo={laneInfo}
                voiceMode={voiceMode}
              />
            </div>
          )}
        </div>
      </section>

      {/* Trust Signals */}
      <TrustSignals />
    </div>
  );
}

export default App;
