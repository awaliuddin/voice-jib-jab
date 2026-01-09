/**
 * Client-side Session Manager
 * Coordinates audio capture, playback, and server communication
 */

import { MicrophoneCapture } from '../audio/MicrophoneCapture';
import { AudioPlayback } from '../audio/AudioPlayback';
import { WebSocketClient } from '../events/WebSocketClient';

export type SessionState = 'idle' | 'initializing' | 'connected' | 'talking' | 'listening' | 'error';

export interface LatencyMetrics {
  ttfb: number | null;
  turnLatency: number | null;
  bargeInStop: number | null;
}

export class SessionManager {
  private wsClient: WebSocketClient;
  private micCapture: MicrophoneCapture;
  private audioPlayback: AudioPlayback;
  private state: SessionState = 'idle';
  private sessionId: string | null = null;
  private metrics: LatencyMetrics = {
    ttfb: null,
    turnLatency: null,
    bargeInStop: null,
  };
  private lastUserSpeechEnd: number = 0;
  private firstAudioChunkTime: number = 0;
  private onStateChange: ((state: SessionState) => void) | null = null;
  private onMetricsUpdate: ((metrics: LatencyMetrics) => void) | null = null;

  constructor(wsUrl: string) {
    this.wsClient = new WebSocketClient(wsUrl);
    this.micCapture = new MicrophoneCapture();
    this.audioPlayback = new AudioPlayback();
  }

  async initialize(): Promise<void> {
    this.setState('initializing');

    try {
      // Initialize components
      await Promise.all([
        this.micCapture.initialize(),
        this.audioPlayback.initialize(),
        this.wsClient.connect(),
      ]);

      // Setup WebSocket handlers
      this.setupWebSocketHandlers();

      // Setup audio playback callback
      this.audioPlayback.setOnPlaybackEnd(() => {
        if (this.state === 'listening') {
          this.setState('connected');
        }
      });

      this.setState('connected');
      console.log('[SessionManager] Initialized successfully');
    } catch (error) {
      console.error('[SessionManager] Initialization failed:', error);
      this.setState('error');
      throw error;
    }
  }

  private setupWebSocketHandlers(): void {
    // Session ready
    this.wsClient.on('session.ready', (message) => {
      this.sessionId = message.sessionId;
      console.log(`[SessionManager] Session ready: ${this.sessionId}`);
    });

    // Audio chunk from server
    this.wsClient.on('audio.chunk', async (message) => {
      // Record TTFB if this is first chunk
      if (this.firstAudioChunkTime === 0) {
        this.firstAudioChunkTime = Date.now();
        const ttfb = this.firstAudioChunkTime - this.lastUserSpeechEnd;
        this.metrics.ttfb = ttfb;
        this.notifyMetricsUpdate();
        console.log(`[SessionManager] TTFB: ${ttfb}ms`);
      }

      try {
        const pcm16Data = Uint8Array.from(atob(message.data), (c) =>
          c.charCodeAt(0)
        ).buffer;
        await this.audioPlayback.enqueueAudio(pcm16Data);

        if (this.state !== 'listening') {
          this.setState('listening');
        }
      } catch (error) {
        console.error('[SessionManager] Error playing audio:', error);
      }
    });

    // Response end
    this.wsClient.on('response.end', () => {
      console.log('[SessionManager] Response ended');
      this.firstAudioChunkTime = 0;

      if (this.state === 'listening') {
        this.setState('connected');
      }
    });

    // Error
    this.wsClient.on('error', (message) => {
      console.error('[SessionManager] Server error:', message.error);
      this.setState('error');
    });
  }

  startTalking(): void {
    if (this.state !== 'connected') {
      console.warn('[SessionManager] Cannot start talking, not connected');
      return;
    }

    // Send session start
    this.wsClient.send({ type: 'session.start' });

    // Start capturing microphone
    this.micCapture.start((audioChunk) => {
      const pcm16Buffer = MicrophoneCapture.float32ToPCM16(audioChunk);
      const base64Data = btoa(
        String.fromCharCode(...new Uint8Array(pcm16Buffer))
      );

      this.wsClient.send({
        type: 'audio.chunk',
        data: base64Data,
        format: 'pcm',
        sampleRate: 24000,
      });
    });

    this.setState('talking');
    console.log('[SessionManager] Started talking');
  }

  stopTalking(): void {
    if (this.state !== 'talking') {
      return;
    }

    this.micCapture.stop();
    this.lastUserSpeechEnd = Date.now();
    this.setState('connected');

    console.log('[SessionManager] Stopped talking');
  }

  /**
   * Trigger barge-in (interrupt assistant)
   */
  bargeIn(): void {
    if (!this.audioPlayback.isActive()) {
      return;
    }

    const bargeInStart = Date.now();

    // Stop audio immediately
    this.audioPlayback.stop();

    const bargeInStop = Date.now() - bargeInStart;
    this.metrics.bargeInStop = bargeInStop;
    this.notifyMetricsUpdate();

    // Notify server
    this.wsClient.send({ type: 'user.barge_in' });

    console.log(`[SessionManager] Barge-in stop time: ${bargeInStop}ms`);

    // Restart talking
    if (this.state === 'listening') {
      this.startTalking();
    }
  }

  disconnect(): void {
    if (this.state === 'idle') {
      return;
    }

    this.wsClient.send({ type: 'session.end' });
    this.wsClient.disconnect();
    this.micCapture.cleanup();
    this.audioPlayback.cleanup();

    this.setState('idle');
    this.sessionId = null;

    console.log('[SessionManager] Disconnected');
  }

  private setState(newState: SessionState): void {
    if (this.state === newState) return;

    this.state = newState;

    if (this.onStateChange) {
      this.onStateChange(newState);
    }
  }

  private notifyMetricsUpdate(): void {
    if (this.onMetricsUpdate) {
      this.onMetricsUpdate({ ...this.metrics });
    }
  }

  getState(): SessionState {
    return this.state;
  }

  getMetrics(): LatencyMetrics {
    return { ...this.metrics };
  }

  setOnStateChange(callback: (state: SessionState) => void): void {
    this.onStateChange = callback;
  }

  setOnMetricsUpdate(callback: (metrics: LatencyMetrics) => void): void {
    this.onMetricsUpdate = callback;
  }

  isAudioPlaying(): boolean {
    return this.audioPlayback.isActive();
  }
}
