/**
 * Voice Interface Component
 * Professional waveform visualization for voice interactions
 */

import React, { useEffect, useState } from 'react';
import { SessionState } from '../state/SessionManager';

interface VoiceInterfaceProps {
  state: SessionState;
  isAudioPlaying: boolean;
  voiceMode: 'push-to-talk' | 'open-mic';
  openMicActive: boolean;
  onPress: () => void;
  onRelease: () => void;
  onBargeIn: () => void;
  onToggleOpenMic: () => void;
  onToggleVoiceMode: () => void;
}

export const VoiceInterface: React.FC<VoiceInterfaceProps> = ({
  state,
  isAudioPlaying,
  voiceMode,
  openMicActive,
  onPress,
  onRelease,
  onBargeIn,
  onToggleOpenMic,
  onToggleVoiceMode,
}) => {
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (state === 'talking' || (state === 'listening' && isAudioPlaying)) {
      interval = setInterval(() => {
        setAudioLevel(Math.random());
      }, 100);
    } else {
      setAudioLevel(0);
    }
    return () => clearInterval(interval);
  }, [state, isAudioPlaying]);

  const getStateText = () => {
    if (state === 'idle') return 'Connect to Start';
    if (state === 'initializing') return 'Initializing...';
    if (state === 'error') return 'Connection Error';
    if (voiceMode === 'open-mic' && openMicActive) {
      return state === 'listening' ? 'AI is speaking' : 'Listening...';
    }
    if (state === 'talking') return 'Listening...';
    if (state === 'listening') return 'AI is speaking';
    return 'Hold to Talk';
  };

  const handleMouseDown = () => {
    if (voiceMode === 'push-to-talk') {
      if (state === 'connected') {
        onPress();
      } else if (state === 'listening' && isAudioPlaying) {
        onBargeIn();
      }
    }
  };

  const handleMouseUp = () => {
    if (voiceMode === 'push-to-talk' && state === 'talking') {
      onRelease();
    }
  };

  const handleClick = () => {
    if (voiceMode === 'open-mic') {
      onToggleOpenMic();
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-12">
      {/* Pre-demo instructions */}
      {state === 'connected' && !openMicActive && (
        <div className="text-center mb-8 animate-slide-down">
          <div className="inline-flex items-center gap-3 px-6 py-3 bg-brand-500/10 border border-brand-500/20 rounded-full backdrop-blur-sm">
            <div className="flex gap-1">
              <div className="w-1 h-4 bg-brand-500 rounded-full animate-waveform" style={{ animationDelay: '0ms' }} />
              <div className="w-1 h-4 bg-brand-500 rounded-full animate-waveform" style={{ animationDelay: '150ms' }} />
              <div className="w-1 h-4 bg-brand-500 rounded-full animate-waveform" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-sm font-medium text-brand-400">
              Ready to talk • {voiceMode === 'push-to-talk' ? 'Hold button to speak' : 'Click to start open mic'}
            </span>
          </div>
        </div>
      )}

      {/* Main voice control */}
      <div className="relative">
        {/* Background glow */}
        <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 blur-3xl transition-opacity duration-500 ${
          state === 'talking' || (openMicActive && state !== 'listening') ? 'opacity-30' : 'opacity-0'
        }`}>
          <div className="absolute inset-0 bg-gradient-radial from-brand-500/40 to-transparent rounded-full" />
        </div>

        {/* Voice button */}
        <button
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchEnd={handleMouseUp}
          onClick={handleClick}
          disabled={state === 'idle' || state === 'initializing' || state === 'error'}
          className={`relative w-64 h-64 mx-auto rounded-full border-4 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
            state === 'talking' || (voiceMode === 'open-mic' && openMicActive && state !== 'listening')
              ? 'border-brand-500 bg-brand-500/20 shadow-glow-brand hover:scale-105 active:scale-95'
              : state === 'listening' && isAudioPlaying
              ? 'border-warning-500 bg-warning-500/20 shadow-glow-warning'
              : 'border-surface-700 bg-surface-850/50 hover:border-surface-600 hover:scale-105 active:scale-95'
          }`}
        >
          {/* Waveform visualization */}
          <div className="absolute inset-0 flex items-center justify-center gap-1.5 px-8">
            {Array.from({ length: 12 }).map((_, i) => {
              const baseHeight = 20;
              const maxHeight = 80;
              const height = (state === 'talking' || (state === 'listening' && isAudioPlaying))
                ? baseHeight + Math.sin(Date.now() / 200 + i) * audioLevel * (maxHeight - baseHeight)
                : baseHeight;

              return (
                <div
                  key={i}
                  className={`w-1.5 rounded-full transition-all duration-150 ${
                    state === 'talking' || (voiceMode === 'open-mic' && openMicActive && state !== 'listening')
                      ? 'bg-brand-500'
                      : state === 'listening' && isAudioPlaying
                      ? 'bg-warning-500'
                      : 'bg-surface-600'
                  }`}
                  style={{
                    height: `${height}%`,
                    transitionDelay: `${i * 30}ms`,
                  }}
                />
              );
            })}
          </div>

          {/* Center icon */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 ${
              state === 'talking' || (voiceMode === 'open-mic' && openMicActive && state !== 'listening')
                ? 'bg-brand-500 text-white'
                : 'bg-surface-800 text-surface-400'
            }`}>
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
            </div>
          </div>

          {/* State label */}
          <div className="absolute -bottom-16 left-0 right-0 text-center">
            <span className="text-base font-medium text-surface-300">
              {getStateText()}
            </span>
          </div>
        </button>
      </div>

      {/* Voice mode toggle */}
      <div className="flex justify-center gap-2 mt-24">
        <button
          onClick={onToggleVoiceMode}
          disabled={state === 'idle' || state === 'initializing' || state === 'error'}
          className={`px-6 py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            voiceMode === 'push-to-talk'
              ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
              : 'bg-surface-850 border-surface-700 text-surface-300 hover:border-brand-500/50 hover:text-white'
          }`}
        >
          Push to Talk
        </button>
        <button
          onClick={onToggleVoiceMode}
          disabled={state === 'idle' || state === 'initializing' || state === 'error'}
          className={`px-6 py-2.5 rounded-lg border text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
            voiceMode === 'open-mic'
              ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
              : 'bg-surface-850 border-surface-700 text-surface-300 hover:border-brand-500/50 hover:text-white'
          }`}
        >
          Open Mic (VAD)
        </button>
      </div>
    </div>
  );
};
