/**
 * Trust Signals Component
 * Enterprise trust indicators and social proof
 */

import React from 'react';

export const TrustSignals: React.FC = () => {
  return (
    <section className="bg-surface-850 py-16 border-t border-surface-800">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <StatCard value="99.99%" label="Uptime SLA" />
          <StatCard value="<400ms" label="Avg TTFB" />
          <StatCard value="10M+" label="Voice minutes/mo" />
          <StatCard value="SOC 2" label="Type II Certified" />
        </div>

        {/* Built with badge */}
        <div className="mt-12 text-center">
          <p className="text-sm text-surface-500">
            Built with NXTG-Forge • Lane-based Architecture
          </p>
        </div>
      </div>
    </section>
  );
};

const StatCard: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <div className="text-center">
    <div className="text-3xl md:text-4xl font-bold text-white font-mono mb-2">
      {value}
    </div>
    <div className="text-sm text-surface-500">
      {label}
    </div>
  </div>
);
