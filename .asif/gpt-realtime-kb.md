# OpenAI Realtime API Knowledge Base
- Source: https://platform.openai.com/docs/guides/realtime

## Realtime API

Build low-latency, multimodal experiences including speech-to-speech.

## Text
gpt-realtime
$4.00 / 1M input tokens
$0.40 / 1M cached input tokens
$16.00 / 1M output tokens
gpt-realtime-mini
$0.60 / 1M input tokens
$0.06 / 1M cached input tokens
$2.40 / 1M output tokens

## Audio
gpt-realtime
$32.00 / 1M input tokens
$0.40 / 1M cached input tokens
$64.00 / 1M output tokens
gpt-realtime-mini
$10.00 / 1M input tokens
$0.30 / 1M cached input tokens
$20.00 / 1M output tokens

## Image
gpt-realtime
$5.00 / 1M input tokens
$0.50 / 1M cached input tokens
-
gpt-realtime-mini
$0.80 / 1M input tokens
$0.08 / 1M cached input tokens
-

## Sora Video API
Richly detailed, dynamic video generation and remixing with our latest generative model.
### Models
| Size | Price per second |
|------|------------------|
| sora-2 | Portrait: 720 x 1280<br>Landscape: 1280 x 720 | $0.10 |
| sora-2-pro | Portrait: 720 x 1280<br>Landscape: 1280 x 720 | $0.30 |
| sora-2-pro | Portrait: 1024 x 1792<br>Landscape: 1792 x 1024 | $0.50 |

Yes—you can *try* sending style directions like “*whisper* okay”, but the Realtime API docs mainly describe steering speech via the session/agent **instructions** (prompting), not a guaranteed “stage-direction markup” that the model will reliably interpret as “whisper” rather than literally reading the asterisks.   
If you need “whispered delivery,” the most reliable approach is to explicitly instruct the model (e.g., “Say ‘okay’ in a whisper, quietly and breathy”) in the session instructions, then test how consistently it follows that style.[1]

## gpt-realtime capabilities + cost

| Feature / capability | What it enables | Concrete use cases | Cost basis / pricing notes |
|---|---|---|---|
| Low-latency realtime interaction | Low-latency communication with models that support speech-to-speech, with multimodal inputs (audio, images, text) and outputs (audio, text).  | Live voice agents, “talk to your app” UX, real-time assistants.  | Billed by input/output tokens when a Response is created (token-based metering). [2] |
| Speech-to-speech (single-model audio loop) | Native audio in → audio out without chaining separate STT + TTS models.  | Customer support voice bot, in-car assistant, realtime coaching.  | Uses Realtime API token pricing (text/audio tokens). [3][4] |
| Multiple connection methods | Connect via WebRTC, WebSocket, or SIP for realtime sessions. [5] | Browser voice agents (WebRTC), server voice gateway (WebSocket), telephony integration (SIP). [5] | Network choice doesn’t change pricing basis (still token-based). [2] |
| “Instructions” steering | Realtime Agents SDK examples show an `instructions` field used to define assistant behavior.  | Enforce call scripts, brand voice, safety rules, tone/verbosity control. [1] | No separate fee—affects token usage (longer instructions = more input tokens). [2] |
| Tool / function calling | The Realtime API supports function calling as a core usage guide and the model is described as improved at calling tools precisely. [1] | Voice agent that books appointments, updates CRM, triggers workflows.  | Model tokens + your own tool execution costs (if any). [2] |
| MCP server support | Realtime supports MCP servers as a documented capability, and community notes mention MCP tool calling. [6] | Plug in hosted tools/skills via MCP; enterprise connectors; agent “skill packs.” [6] | Model tokens + MCP/server-side infra costs you operate. [2] |
| Image input in Realtime sessions | gpt-realtime supports image inputs alongside audio/text in a Realtime session (per OpenAI announcement). [1] | “What am I looking at?” voice assistant, QA from screenshots, multimodal troubleshooting. [1] | Token-based (image input contributes to usage). [2] |
| Realtime transcription | Docs describe realtime audio transcription as a supported use case/guide area.  | Live captions, meeting transcription, voice analytics.  | Transcription has specific event streams and billing exceptions noted in cost docs. [2][7] |
| Longer sessions + large context | Sessions can last up to 60 minutes; `gpt-realtime` has a 32,768 token window; responses can use up to 4,096 tokens. [8] | Long-running calls, ongoing agent sessions, fewer reconnections. [8] | Longer sessions can increase token spend; use truncation/token limits to manage cost. [1] |
| New voices (model-dependent) | OpenAI announced new voices “Cedar” and “Marin” available exclusively in the Realtime API. [1] | Brand-specific voice UX, differentiated assistant personalities. [1] | Voice selection itself isn’t priced separately; usage still token-based. [2] |

### Known official price points (from OpenAI pricing pages)
- **gpt-realtime text input**: $4.00 / 1M tokens; **cached input**: $0.40 / 1M tokens.[4]
- Realtime **text output** shown as $16.00 / 1M tokens (on OpenAI pricing).[3]
- OpenAI pricing pages also list Realtime audio token pricing (token-based), but details can vary by model/version—verify the current table before locking unit economics.[3][4]

## The “*whisper* okay” question
- The docs show you can provide high-level behavioral **instructions** to steer the assistant, which is the supported way to control speaking style.   
- What’s *not* clearly documented is a special markup language where “*whisper* …” is guaranteed to be interpreted as prosody control instead of literal text.   
- Practical move: define a convention in your instructions (e.g., “If user message contains *whisper*, respond in a whispery, quiet voice and do not read the asterisks aloud”) and run quick A/B tests for consistency across voices.[1]

## Source integrity rating
- OpenAI platform docs + pricing pages: **High credibility**, low bias, highest usefulness for implementation/pricing.[4][3]
- OpenAI announcement/blog posts: **High credibility**, mild marketing bias, great for feature intent + availability context.[8][1]
- Third-party pricing explainers: **Medium credibility**, can be helpful for intuition but must be validated against official pricing tables.[9]

If you share your target UX (“whisper” = quieter volume, breathy timbre, or both) and whether you’re using WebRTC or WebSocket, a concrete prompt + event flow can be drafted.

[1](https://openai.com/index/introducing-gpt-realtime/)
[2](https://platform.openai.com/docs/guides/realtime-costs)
[3](https://openai.com/api/pricing/)
[4](https://platform.openai.com/docs/pricing)
[5](https://platform.openai.com/docs/models/gpt-realtime)
[6](https://www.linkedin.com/posts/dkundel_the-openai-realtime-api-is-ga-and-with-it-activity-7366898895487971329-Bb4e)
[7](https://platform.openai.com/docs/guides/realtime-transcription)
[8](https://developers.openai.com/blog/realtime-api/)
[9](https://skywork.ai/blog/agent/openai-realtime-api-pricing-2025-cost-calculator/)
[10](https://www.perplexity.ai/changelog/what-we-shipped-september-5th)
[11](https://www.perplexity.ai/hub/blog/introducing-the-perplexity-search-api)
[12](https://www.perplexity.ai/hub/blog/introducing-the-sonar-pro-api)
[13](https://www.perplexity.ai/changelog/what-we-shipped-june-27th)
[14](https://www.perplexity.ai/changelog/what-we-shipped---december-5th)
[15](https://www.perplexity.ai/hub/blog/agents-or-bots-making-sense-of-ai-on-the-open-web)
[16](https://www.perplexity.ai/help-center/en/articles/10352155-what-is-perplexity)
[17](https://platform.openai.com/docs/guides/realtime)
[18](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/realtime-audio-quickstart?view=foundry-classic)
[19](https://platform.openai.com/docs/guides/speech-to-text)
[20](https://community.openai.com/t/how-to-get-text-only-output-from-the-realtime-api/967528)
[21](https://platform.openai.com/docs/guides/realtime-conversations)
[22](https://www.youtube.com/watch?v=EUhkjkNENgM)