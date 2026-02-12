/**
 * Navigation Component
 * Enterprise-grade navigation bar with sticky positioning
 */

import React from 'react';

export const Navigation: React.FC = () => {
  return (
    <nav className="sticky top-0 z-50 bg-surface-900/80 backdrop-blur-xl border-b border-surface-800">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">
              Voice Jib-Jab
            </span>
            <span className="px-2 py-0.5 text-xs font-semibold tracking-wider uppercase text-brand-400 bg-brand-500/10 rounded border border-brand-500/20">
              Beta
            </span>
          </div>

          {/* Navigation links */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#docs" className="text-sm font-medium text-surface-400 hover:text-white transition-colors">
              Documentation
            </a>
            <a href="#pricing" className="text-sm font-medium text-surface-400 hover:text-white transition-colors">
              Pricing
            </a>
            <a href="#api" className="text-sm font-medium text-surface-400 hover:text-white transition-colors">
              API Reference
            </a>
            <a href="https://github.com" className="text-sm font-medium text-surface-400 hover:text-white transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
              </svg>
              GitHub
            </a>
          </div>

          {/* CTA */}
          <div className="flex items-center gap-3">
            <button className="hidden sm:block px-4 py-2 text-sm font-medium text-surface-300 hover:text-white transition-colors">
              Sign In
            </button>
            <button className="px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold rounded-lg transition-all hover:scale-[1.02] active:scale-[0.98]">
              Get API Key
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
