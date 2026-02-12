/**
 * Performance Showcase Component
 * Transforms debug metrics into enterprise-grade performance visualization
 */

import React from 'react';
import { LatencyMetrics, LaneInfo, VoiceMode } from '../state/SessionManager';

interface PerformanceShowcaseProps {
  metrics: LatencyMetrics;
  laneInfo?: LaneInfo;
  voiceMode?: VoiceMode;
  isMinimized?: boolean;
}

export const PerformanceShowcase: React.FC<PerformanceShowcaseProps> = ({
  metrics,
  laneInfo,
  isMinimized = false,
}) => {
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 bg-surface-850/90 backdrop-blur-xl border border-surface-700 rounded-xl p-4 shadow-2xl z-40">
        <div className="flex items-center gap-4">
          <MetricPill label="TTFB" value={metrics.ttfb} target={400} />
          <MetricPill label="Turn" value={metrics.turnLatency} target={500} />
          <MetricPill label="Barge-in" value={metrics.bargeInStop} target={250} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-fade-in">
      {/* Section label */}
      <div className="text-center mb-8">
        <span className="inline-block px-3 py-1 text-xs font-semibold tracking-wider uppercase text-brand-400 bg-brand-500/10 rounded-full border border-brand-500/20">
          Real-time Performance
        </span>
        <h3 className="text-2xl font-bold text-white mt-4 mb-2">
          Built for Production at Scale
        </h3>
        <p className="text-surface-400">
          Live metrics from our demo instance. Your mileage may improve.
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MetricCard
          label="Time to First Byte"
          value={metrics.ttfb}
          unit="ms"
          target={400}
          description="How fast AI starts responding"
          icon="⚡"
        />
        <MetricCard
          label="Turn Latency"
          value={metrics.turnLatency}
          unit="ms"
          target={500}
          description="Total conversation round-trip"
          icon="🔄"
        />
        <MetricCard
          label="Barge-in Stop"
          value={metrics.bargeInStop}
          unit="ms"
          target={250}
          description="Interrupt response time"
          icon="✋"
        />
      </div>

      {/* Lane Info */}
      {laneInfo && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-surface-850/50 border border-surface-800 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-sm text-surface-500 mb-1">Audio Owner</div>
            <div className="text-lg font-semibold text-white font-mono">
              {laneInfo.owner === 'A'
                ? 'Lane A (Reflex)'
                : laneInfo.owner === 'B'
                  ? 'Lane B (AI)'
                  : laneInfo.owner === 'fallback'
                    ? 'Fallback'
                    : 'None'}
            </div>
          </div>
          <div className="bg-surface-850/50 border border-surface-800 rounded-xl p-4 backdrop-blur-sm">
            <div className="text-sm text-surface-500 mb-1">Lane State</div>
            <div className="text-lg font-semibold text-white font-mono">
              {formatLaneState(laneInfo.state)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface MetricCardProps {
  label: string;
  value: number | null;
  unit: string;
  target: number;
  description: string;
  icon: string;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, unit, target, description, icon }) => {
  const performance = getPerformanceLevel(value, target);
  const colorMap = {
    excellent: 'text-success-500 border-success-500/30 bg-success-500/5',
    good: 'text-brand-500 border-brand-500/30 bg-brand-500/5',
    fair: 'text-warning-500 border-warning-500/30 bg-warning-500/5',
    poor: 'text-error-500 border-error-500/30 bg-error-500/5',
    unknown: 'text-surface-500 border-surface-700 bg-surface-850/50',
  };

  return (
    <div className={`relative overflow-hidden rounded-xl border p-6 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] ${colorMap[performance]}`}>
      {/* Shimmer effect on hover */}
      <div className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-500">
        <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>

      <div className="relative">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-medium text-surface-400">{label}</span>
          <div className="text-2xl opacity-50">{icon}</div>
        </div>

        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-4xl font-bold font-mono">
            {value !== null ? value.toFixed(0) : '-'}
          </span>
          <span className="text-lg text-surface-500 font-mono">{unit}</span>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-surface-500">{description}</p>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-surface-900/50">
            Target: {target}{unit}
          </span>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-1 bg-surface-900 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              performance === 'excellent' ? 'bg-success-500' :
              performance === 'good' ? 'bg-brand-500' :
              performance === 'fair' ? 'bg-warning-500' :
              performance === 'poor' ? 'bg-error-500' : 'bg-surface-600'
            }`}
            style={{
              width: value !== null ? `${Math.min((target / value) * 100, 100)}%` : '0%'
            }}
          />
        </div>
      </div>
    </div>
  );
};

const MetricPill: React.FC<{ label: string; value: number | null; target: number }> = ({ label, value, target }) => {
  const performance = getPerformanceLevel(value, target);
  const colorMap = {
    excellent: 'text-success-500',
    good: 'text-brand-500',
    fair: 'text-warning-500',
    poor: 'text-error-500',
    unknown: 'text-surface-500',
  };

  return (
    <div className="flex flex-col items-center">
      <span className="text-xs text-surface-500 mb-1">{label}</span>
      <span className={`text-lg font-bold font-mono ${colorMap[performance]}`}>
        {value !== null ? `${value.toFixed(0)}ms` : '-'}
      </span>
    </div>
  );
};

function getPerformanceLevel(value: number | null, target: number): 'excellent' | 'good' | 'fair' | 'poor' | 'unknown' {
  if (value === null) return 'unknown';
  if (value < target) return 'excellent';
  if (value < target * 1.3) return 'good';
  if (value < target * 1.5) return 'fair';
  return 'poor';
}

function formatLaneState(state: string): string {
  const stateMap: Record<string, string> = {
    'IDLE': 'Idle',
    'LISTENING': 'Listening',
    'A_PLAYING': 'Reflex Playing',
    'B_RESPONDING': 'AI Processing',
    'B_PLAYING': 'AI Speaking',
    'FALLBACK_PLAYING': 'Fallback Speaking',
    'ENDED': 'Ended',
  };
  return stateMap[state] || state;
}
