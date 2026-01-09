# Voice Jib-Jab Testing Guide

## OpenAI Realtime API Integration Testing

This guide provides step-by-step instructions for testing the Voice Jib-Jab system with the newly integrated OpenAI Realtime API.

## Prerequisites

1. **OpenAI API Key**: You need an OpenAI API key with access to the Realtime API
   - Sign up at https://platform.openai.com/
   - Navigate to API Keys section
   - Create a new key with Realtime API access
   - The Realtime API requires GPT-4o model access

2. **System Requirements**:
   - Node.js 18+ installed
   - Modern browser with WebRTC support (Chrome, Firefox, Edge)
   - Microphone and speakers/headphones
   - Stable internet connection

## Setup Instructions

### 1. Configure Server Environment

```bash
cd server

# Copy example environment file
cp .env.example .env

# Edit .env file and add your OpenAI API key
# Set: OPENAI_API_KEY=your_actual_api_key_here
# Model should be: gpt-4o-realtime-preview-2024-12-17
```

### 2. Install Dependencies

```bash
# In server directory
cd server
npm install

# In client directory
cd ../client
npm install
```

### 3. Start the System

```bash
# Terminal 1: Start the server
cd server
npm run dev

# Terminal 2: Start the client
cd client
npm run dev
```

The server will start on `http://localhost:3000`
The client will start on `http://localhost:5173`

## Testing Voice Conversations

### Initial Connection Test

1. **Open the Application**
   - Navigate to `http://localhost:5173` in your browser
   - You should see the Voice Jib-Jab interface

2. **Grant Microphone Permission**
   - When prompted, allow microphone access
   - Ensure your microphone is working and not muted

3. **Start a Session**
   - Click the microphone button to start recording
   - The UI should indicate "Listening" state

### Voice Conversation Flow

1. **Speak to the Assistant**
   - Say: "Hello, can you hear me?"
   - Wait for the speech detection to stop (automatic with VAD)
   - You should see your transcript appear in the UI

2. **Listen for Response**
   - The assistant should respond with audio
   - You'll see the transcript of the assistant's response
   - The audio should play automatically through your speakers

3. **Test Conversation Features**
   - **Multi-turn conversation**: Have a back-and-forth dialogue
   - **Interruption (Barge-in)**: Start speaking while the assistant is responding
   - **Silence detection**: Pause speaking and observe automatic turn-taking

### Console Monitoring

Open browser developer console (F12) to monitor:

```javascript
// Expected console logs during successful operation:

[WebSocket] Connected
[WebSocket] Message: session.ready
[OpenAI] Connecting to Realtime API for session: xxx
[OpenAI] WebSocket connected for session: xxx
[OpenAI] Session configuration sent
[OpenAI] Session created successfully
[OpenAI] Speech detected - started
[OpenAI] Sent audio chunk: 4096 bytes
[OpenAI] Speech detected - stopped
[OpenAI] Audio buffer committed
[OpenAI] Response started
[OpenAI] Received message: response.audio.delta
[OpenAI] Response complete
```

### Server Logs

Monitor server terminal for:

```
[WebSocket] New client connected
[OpenAI] Connecting to Realtime API for session: xxx
[OpenAI] WebSocket connected for session: xxx
[OpenAI] Session configuration sent
[OpenAI] Session created successfully
[OpenAI] Sent audio chunk: xxx bytes
[OpenAI] Audio buffer committed
[OpenAI] Response started
[OpenAI] Response complete
```

## Troubleshooting

### Connection Issues

**Problem**: "Not connected to OpenAI Realtime API" error
- **Solution**: Check your API key is valid and has Realtime API access
- Verify the model name in .env matches available models
- Check network connectivity

**Problem**: WebSocket connection fails
- **Solution**: Ensure server is running on correct port
- Check firewall/proxy settings
- Verify OpenAI API is accessible from your network

### Audio Issues

**Problem**: No audio input detected
- **Solution**: Check microphone permissions in browser
- Verify microphone is not muted at OS level
- Test microphone in browser settings

**Problem**: No audio playback
- **Solution**: Check speaker/headphone connection
- Verify browser autoplay policies (user interaction may be required)
- Check audio format compatibility

**Problem**: Audio is choppy or distorted
- **Solution**: Check network latency
- Reduce concurrent network usage
- Try adjusting sample rate in configuration

### API Errors

**Problem**: Rate limit errors
- **Solution**: OpenAI Realtime API has rate limits
- Reduce frequency of requests
- Implement exponential backoff

**Problem**: Invalid API key
- **Solution**: Verify key in .env file
- Ensure no extra spaces or quotes
- Check key hasn't been revoked

## Performance Metrics

Monitor these key metrics during testing:

1. **Time to First Byte (TTFB)**
   - Target: <400ms (P50), <900ms (P95)
   - Measured from end of speech to first audio chunk

2. **Barge-in Latency**
   - Target: <250ms (P95)
   - Time from interruption to response cancellation

3. **End-to-End Latency**
   - Full round-trip from speech end to response start
   - Should feel natural and conversational

## Advanced Testing

### Testing Different Voices

Edit `server/src/providers/OpenAIRealtimeAdapter.ts`:

```typescript
// Line 146 - Change voice option
voice: "alloy", // Options: alloy, echo, fable, onyx, nova, shimmer
```

### Adjusting VAD Settings

Modify Voice Activity Detection sensitivity:

```typescript
// Line 152-156 in OpenAIRealtimeAdapter.ts
turn_detection: {
  type: "server_vad",
  threshold: 0.5,        // Adjust: 0.0-1.0 (lower = more sensitive)
  prefix_padding_ms: 300, // Pre-speech buffer
  silence_duration_ms: 500 // Silence before turn end
}
```

### Testing Without VAD

For manual turn-taking control:

```typescript
turn_detection: {
  type: "none"  // Disable automatic turn detection
}
```

Then manually trigger responses after user speech.

## Expected Behavior Summary

✅ **Working Features**:
- WebSocket connection to OpenAI Realtime API
- Bidirectional audio streaming (PCM16 format)
- Automatic speech detection (VAD)
- Real-time transcription
- Natural voice responses
- Interruption handling (barge-in)
- Session management
- Error recovery and reconnection

❌ **Not Yet Implemented**:
- RAG integration
- Lane A/B/C routing
- Policy gates
- Audit trail persistence
- Advanced session analytics

## Development Tips

1. **Enable Verbose Logging**: Set `NODE_ENV=development` for detailed logs
2. **Test Offline**: Use stub mode by disconnecting internet after initial load
3. **Simulate Errors**: Temporarily invalid API key to test error handling
4. **Monitor WebSocket**: Use browser WS inspector in Network tab
5. **Audio Debugging**: Record audio chunks to file for analysis

## Next Steps

Once basic conversation is working:

1. Test edge cases (long silence, rapid speech, multiple languages)
2. Measure and optimize latency metrics
3. Implement remaining features (RAG, Lanes, etc.)
4. Add comprehensive error handling
5. Deploy to production environment

## Support

If you encounter issues:

1. Check console logs (browser and server)
2. Verify all prerequisites are met
3. Review OpenAI Realtime API documentation
4. Ensure API quotas haven't been exceeded

The system is now ready for voice conversation testing!