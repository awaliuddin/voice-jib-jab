/**
 * Talk Button Component
 * Main interaction button for voice conversations
 */

import React from 'react';
import { SessionState } from '../state/SessionManager';

interface TalkButtonProps {
  state: SessionState;
  isAudioPlaying: boolean;
  onPress: () => void;
  onRelease: () => void;
  onBargeIn: () => void;
}

export const TalkButton: React.FC<TalkButtonProps> = ({
  state,
  isAudioPlaying,
  onPress,
  onRelease,
  onBargeIn,
}) => {
  const getButtonText = (): string => {
    switch (state) {
      case 'idle':
        return 'Connect';
      case 'initializing':
        return 'Initializing...';
      case 'connected':
        return 'Hold to Talk';
      case 'talking':
        return 'Listening...';
      case 'listening':
        return 'Assistant Speaking';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };

  const getButtonClass = (): string => {
    const baseClass = 'talk-button';

    switch (state) {
      case 'talking':
        return `${baseClass} ${baseClass}--active`;
      case 'listening':
        return `${baseClass} ${baseClass}--listening`;
      case 'error':
        return `${baseClass} ${baseClass}--error`;
      default:
        return baseClass;
    }
  };

  const handleMouseDown = () => {
    if (state === 'connected') {
      onPress();
    } else if (state === 'listening') {
      onBargeIn();
    }
  };

  const handleMouseUp = () => {
    if (state === 'talking') {
      onRelease();
    }
  };

  const disabled = state === 'idle' || state === 'initializing' || state === 'error';

  return (
    <div className="talk-button-container">
      <button
        className={getButtonClass()}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleMouseDown}
        onTouchEnd={handleMouseUp}
        disabled={disabled}
      >
        <span className="talk-button__icon">🎙️</span>
        <span className="talk-button__text">{getButtonText()}</span>
      </button>

      {state === 'connected' && (
        <div className="talk-button__hint">Press and hold to speak</div>
      )}

      {state === 'listening' && (
        <div className="talk-button__hint">Press to interrupt</div>
      )}
    </div>
  );
};
