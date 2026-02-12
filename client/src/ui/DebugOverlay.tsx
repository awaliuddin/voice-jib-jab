/**
 * Debug Overlay Component
 * Shows real-time metrics and system status
 */

import React from "react";
import {
  SessionState,
  LatencyMetrics,
  LaneInfo,
  VoiceMode,
} from "../state/SessionManager";

interface DebugOverlayProps {
  state: SessionState;
  metrics: LatencyMetrics;
  laneInfo?: LaneInfo;
  voiceMode?: VoiceMode;
  isVisible: boolean;
}

export const DebugOverlay: React.FC<DebugOverlayProps> = ({
  state,
  metrics,
  laneInfo,
  voiceMode,
  isVisible,
}) => {
  if (!isVisible) return null;

  const getLaneOwnerLabel = (owner: string): string => {
    switch (owner) {
      case "A":
        return "Lane A (Reflex)";
      case "B":
        return "Lane B (AI)";
      case "fallback":
        return "Fallback";
      default:
        return "None";
    }
  };

  const getLaneStateLabel = (laneState: string): string => {
    switch (laneState) {
      case "IDLE":
        return "Idle";
      case "LISTENING":
        return "Listening";
      case "A_PLAYING":
        return "Reflex Playing";
      case "B_RESPONDING":
        return "AI Processing";
      case "B_PLAYING":
        return "AI Speaking";
      case "FALLBACK_PLAYING":
        return "Fallback Speaking";
      case "ENDED":
        return "Ended";
      default:
        return laneState;
    }
  };

  const formatMetric = (value: number | null): string => {
    if (value === null) return "-";
    return `${value.toFixed(0)}ms`;
  };

  const getMetricClass = (value: number | null, target: number): string => {
    if (value === null) return "metric--unknown";
    if (value < target) return "metric--good";
    if (value < target * 1.5) return "metric--warning";
    return "metric--poor";
  };

  return (
    <div className="debug-overlay">
      <div className="debug-overlay__header">
        <span className="debug-overlay__title">🔧 Debug Metrics</span>
        <span className={`debug-overlay__state debug-overlay__state--${state}`}>
          {state}
        </span>
      </div>

      <div className="debug-overlay__section">
        <h4>Latency Targets</h4>
        <div className="metric-grid">
          <div className="metric">
            <span className="metric__label">TTFB (Target: 400ms)</span>
            <span
              className={`metric__value ${getMetricClass(metrics.ttfb, 400)}`}
            >
              {formatMetric(metrics.ttfb)}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">Turn Latency</span>
            <span className="metric__value">
              {formatMetric(metrics.turnLatency)}
            </span>
          </div>
          <div className="metric">
            <span className="metric__label">Barge-in (Target: 250ms)</span>
            <span
              className={`metric__value ${getMetricClass(
                metrics.bargeInStop,
                250,
              )}`}
            >
              {formatMetric(metrics.bargeInStop)}
            </span>
          </div>
        </div>
      </div>

      {laneInfo && (
        <div className="debug-overlay__section">
          <h4>Lane Arbitration</h4>
          <div className="metric-grid">
            <div className="metric">
              <span className="metric__label">Audio Owner</span>
              <span className="metric__value">
                {getLaneOwnerLabel(laneInfo.owner)}
              </span>
            </div>
            <div className="metric">
              <span className="metric__label">Lane State</span>
              <span className="metric__value">
                {getLaneStateLabel(laneInfo.state)}
              </span>
            </div>
          </div>
        </div>
      )}

      {voiceMode && (
        <div className="debug-overlay__section">
          <h4>Voice Mode</h4>
          <div className="metric-grid">
            <div className="metric">
              <span className="metric__label">Mode</span>
              <span className="metric__value">
                {voiceMode === "push-to-talk" ? "Push to Talk" : "Open Mic"}
              </span>
            </div>
            <div className="metric">
              <span className="metric__label">VAD</span>
              <span className="metric__value">
                {voiceMode === "push-to-talk" ? "Disabled" : "Enabled"}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="debug-overlay__section">
        <h4>Legend</h4>
        <div className="legend">
          <span className="legend__item">
            <span className="legend__dot legend__dot--good"></span> Within
            target
          </span>
          <span className="legend__item">
            <span className="legend__dot legend__dot--warning"></span> Above
            target
          </span>
          <span className="legend__item">
            <span className="legend__dot legend__dot--poor"></span> Well above
          </span>
        </div>
      </div>
    </div>
  );
};
