<h1 align="center">🎮 earlygod.ai</h1>
<p align="center"><strong>The AI voice assistant for gamers. Talk to it while you play. It can see your screen, knows your game, searches the web for anything it doesn't, and answers in real time.</strong></p>
<p align="center"><em>Quests · Builds · Weapons · Boss fights · Lore · Anything you need, hands-free, low-latency, voice-first.</em></p>
<p align="center"><em>Open-source · Electron · BYO API key (OpenAI / Gemini / Claude)</em></p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">▶️ Demo 1</a> ·
  <a href="https://www.youtube.com/watch?v=5UBd3aExrnU">▶️ Demo 2</a> ·
  <a href="https://earlygod.ai">🌐 Website</a>
</p>

<p align="center">
  <a href="https://github.com/stillmanish/earlygod-ai/actions/workflows/ci.yml"><img src="https://github.com/stillmanish/earlygod-ai/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img src="https://img.shields.io/badge/electron-app-47848f">
  <img src="https://img.shields.io/badge/node-20%2B-green">
  <img src="https://img.shields.io/badge/platform-Windows-blue">
  <img src="https://img.shields.io/badge/status-reference%20implementation-yellow">
</p>

---

## What it is

**earlygod.ai** is a voice-first AI assistant you talk to while you play. Ask it anything — quests, builds, weapons, boss strategies, lore, where to go next — and it answers out loud, in real time, without you ever leaving the game. It sees your screen, knows what game you're in, and searches the web for anything it doesn't already have a primer for. No alt-tab. No pausing. No second monitor.

- 🗣️ **Voice-first, conversational** — talk to it like a friend who's watched 200 hours of guides (Deepgram STT + ElevenLabs TTS)
- 👀 **Sees your screen** — real-time vision understands what's happening in your game right now
- 🌐 **Web search built-in** — works for brand-new releases and obscure games even without a pre-built primer
- ⚡ **Low latency** — answers come back fast enough to use mid-fight, not after you've already died
- 🎯 **Auto-detects your game** — no setup, no manual configuration
- 🧠 **13 game primers included** — Elden Ring, Ghost of Yotei, Black Myth: Wukong, AOE2, Expedition 33, and more
- 🔒 **Local-first, BYO keys** — runs on your machine, uses your own API keys, zero telemetry, no cloud lock-in

---

## Demo

<table>
  <tr>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">
        <img src="https://img.youtube.com/vi/jgtbSzAXFtY/hqdefault.jpg" alt="earlygod.ai demo 1" width="400">
      </a>
      <br>
      <strong>▶️ <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">Demo 1: earlygod.ai in action</a></strong>
    </td>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=5UBd3aExrnU">
        <img src="https://img.youtube.com/vi/5UBd3aExrnU/hqdefault.jpg" alt="earlygod.ai demo 2" width="400">
      </a>
      <br>
      <strong>▶️ <a href="https://www.youtube.com/watch?v=5UBd3aExrnU">Demo 2: earlygod.ai in another game</a></strong>
    </td>
  </tr>
</table>

---

## Architecture

earlygod.ai is structured as a 7-layer real-time AI processing pipeline split across two backend services and an Electron desktop client. The architecture diagram below shows the high-level structure.

```
┌─────────────────────────────────────────────────────────────┐
│  Electron Frontend (frontend/)                              │
│  - Game window detection                                    │
│  - Screen capture                                           │
│  - Overlay UI                                               │
│  - Voice I/O (Deepgram + ElevenLabs)                        │
└──────────────┬──────────────────────────┬───────────────────┘
               │                          │
               ▼                          ▼
┌────────────────────────────┐  ┌─────────────────────────────┐
│  Main Backend              │  │  Quest Mode Backend         │
│  early-god-backend/        │  │  boss-mode-backend/         │
│  Port 3001                 │  │  Port 8081                  │
│  - 7-layer orchestrator    │  │  - Vision analysis          │
│  - Voice agent + RAG       │  │  - Proactive agent          │
│  - Memory + sessions       │  │  - Map service              │
│  - Game-rule engine        │  │                             │
└────────────────────────────┘  └─────────────────────────────┘
```

The two backends are deliberately split so heavy vision analysis (quest-mode) doesn't block real-time audio streaming on the main backend.

---

## Quick Start

### Prerequisites

- **Node.js 20+** ([nodejs.org](https://nodejs.org/))
- **Windows 10/11** (Mac/Linux: see [Platform Support](#platform-support))
- A game running in **windowed** or **borderless windowed** mode (overlay won't show in fullscreen exclusive)
- API keys for your chosen providers (see [API Keys](#api-keys))
- Postgres is **optional** — if not configured, the app runs with in-process memory only

### Installation

```bash
# 1. Clone
git clone https://github.com/stillmanish/earlygod-ai.git
cd earlygod-ai

# 2. Install everything (all 3 packages via one command)
npm install

# 3. Interactive setup — paste your API keys, writes .env for you
npm run setup

# 4. Start everything (both backends + Electron frontend)
npm start
```

That's it. Press **F12** to toggle the in-game overlay.

Want a Postgres-backed memory layer? Get a free Neon database at [neon.tech](https://neon.tech), paste the connection string when `npm run setup` asks, then run `psql $DATABASE_URL < early-god-backend/database.sql` to load the schema.

---

## API Keys

You'll need three categories of keys. All have free tiers.

| Service | Required | Purpose | Get a key |
|---------|----------|---------|-----------|
| **OpenAI** *or* **Gemini** *or* **Anthropic** | ✅ Pick one | Main reasoning engine | [openai.com](https://platform.openai.com/api-keys) · [aistudio.google.com](https://aistudio.google.com/apikey) · [console.anthropic.com](https://console.anthropic.com) |
| **Deepgram** | ✅ Required | Real-time speech-to-text | [console.deepgram.com](https://console.deepgram.com/) (free $200 credit) |
| **ElevenLabs** | ✅ Required | Text-to-speech voice output | [elevenlabs.io](https://elevenlabs.io/app/settings/api-keys) (free tier available) |

Optional:
- **Postgres database** — recommended [Neon](https://neon.tech) (free) for game session memory
- **Clerk** — only if you want auth (set Clerk env vars in `.env`, or leave empty for no-auth single-user mode)
- **YouTube Data API** — only if you want to fetch game guide videos automatically

---

## Game Library

13 game primers ship with v1:

| Game | Genre | Primer status |
|------|-------|---------------|
| Elden Ring | Souls-like | ✅ |
| Elden Ring: Shadow of the Erdtree | Souls-like DLC | ✅ |
| Ghost of Tsushima | Action-Adventure | ✅ |
| Ghost of Yotei | Action-Adventure | ✅ |
| Black Myth: Wukong | Action RPG | ✅ |
| Crimson Desert | Open-world RPG | ✅ |
| Expedition 33 | Turn-based JRPG | ✅ |
| Kingdom Come: Deliverance II | Open-world RPG | ✅ |
| Age of Empires II | RTS | ✅ |
| Age of Empires IV | RTS | ✅ |
| Europa Universalis V | Grand strategy | ✅ |
| League of Legends | MOBA | ✅ |

Adding your own game takes ~30 minutes. Copy any existing JSON in `frontend/game-primers/` as a template — the schema includes `gameTitle`, `genre`, `coreMechanics`, `terminology`, and other fields.

---

## ⚠️ Important Warnings

**This tool captures your screen.** Some online games with anti-cheat (Valorant, CS2, Fortnite, R6 Siege, Apex Legends) may flag screen capture tools as cheats. **Use earlygod.ai with single-player or co-op PvE games only.** I take no responsibility for bans in competitive online games.

**Privacy:** earlygod.ai runs entirely on your machine. Your screen captures, voice, and game data are sent only to the API providers you configure (OpenAI/Gemini/Deepgram/ElevenLabs/your own database). I do not collect any telemetry. There is no analytics server. There is no cloud sync.

---

## Project Status

This is a **reference implementation** released under MIT. It's the actual working code from a real product I built and used for months.

**What this means:**
- ✅ It works (I used it through hundreds of hours of gameplay)
- ✅ The architecture is real, not a toy demo
- ✅ Open source forever, no rug pull
- ⚠️ I am **not actively maintaining** this — pull requests are welcome but I may not review them promptly
- ⚠️ Forks are encouraged. If you want to take this further, fork it and make it yours.

If you build something cool with this, I'd love to hear about it.

---

## Platform Support

| Platform | Status |
|----------|--------|
| Windows 10/11 | ✅ Tested, primary platform |
| macOS | ⚠️ Untested — game window detection uses Windows APIs |
| Linux | ⚠️ Untested — same as macOS |

Mac/Linux ports would need to swap the game detection layer (`frontend/gameDetection.js`) for platform-native APIs. PRs welcome.

---

## Contributing

PRs are welcome but not actively reviewed. The easiest contribution is **adding a game primer** for a game you love — copy any existing JSON in `frontend/game-primers/` as a template. If you fork and ship something cool, open an issue and I'll link it here.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

---

## Tech Stack

- **Frontend:** Electron + vanilla JS
- **Backend:** Node.js + Express
- **Real-time:** WebSocket
- **AI:** OpenAI / Google Gemini / Anthropic Claude (pluggable)
- **Voice:** Deepgram (STT) + ElevenLabs (TTS)
- **Database:** PostgreSQL (Neon)
- **Auth:** Clerk (optional, swappable)
- **Game RAG:** Local file-based search over JSON game primers (no embeddings, no Google Cloud needed)

---

## FAQ

### What games does this work with?
Any game, really. 13 games ship with pre-built primers (Elden Ring, Black Myth: Wukong, Ghost of Tsushima, Ghost of Yotei, Age of Empires II, Age of Empires IV, Europa Universalis V, Crimson Desert, Kingdom Come: Deliverance II, Expedition 33, League of Legends, and more) — but for anything else, earlygod.ai falls back to live web search, so it works for brand-new releases and obscure titles too. You can also add your own primer in ~30 minutes by writing a JSON file in `frontend/game-primers/`.

### Does it work for games that don't have a primer?
Yes. When a game isn't in the primer library, earlygod.ai uses live web search to pull answers from the open web. That means day-one releases, indie games, and anything niche all work out of the box — you just won't get the tighter, primer-grounded answers you'd get for the 13 supported titles.

### How is this different from a wiki or YouTube guide?
Wikis and YouTube guides require you to pause the game, alt-tab, search, and read. earlygod.ai watches your screen in real time, knows what's happening in your game, and proactively coaches you through it via voice — no second screen, no pausing, no friction.

### Does it work offline?
Mostly no — the AI providers (OpenAI / Gemini / Anthropic for reasoning, Deepgram for transcription, ElevenLabs for voice) all need internet to call their APIs. The game primer search is fully local, but the rest needs cloud calls. If you want fully offline, swap in Ollama for the LLM and a local Whisper for transcription (PRs welcome).

### Is my gameplay data private?
Your screen captures, audio, and game data go directly from your machine to the API providers you configure (using YOUR API keys). earlygod.ai itself collects zero telemetry. There is no analytics server. There is no cloud sync. The maintainer has zero visibility into how you use this.

### Can I add my own game?
Yes — copy any JSON file in `frontend/game-primers/` as a template. Fill in the game's mechanics, terminology, and tips. Drop it in the same directory and earlygod.ai picks it up automatically. Takes about 30 minutes for a decent primer.

### Is it free?
The earlygod.ai code is MIT licensed and free forever. The AI providers it talks to have free tiers:
- **Google Gemini:** Free with rate limits — best free option
- **Deepgram:** $200 free credit on signup (hundreds of hours of streaming transcription)
- **ElevenLabs:** Free tier with ~10 minutes of speech per month
- **Neon Postgres:** Free 0.5 GB tier
- **Total cost using free tiers: $0/month**

### Will I get banned in online games?
**Maybe** — see the warning above. Some online games with anti-cheat (Valorant, CS2, Fortnite, R6 Siege, Apex Legends) flag screen capture tools as cheats. **Use earlygod.ai with single-player or co-op PvE games only.** Don't blame the maintainer if you get banned in competitive games.

### Why both OpenAI AND Gemini AND Anthropic support?
Pluggable. Pick the model that works best for you. The reasoning layer is provider-agnostic — you set whichever API key you have and the rest just works.

### What's the architecture in plain English?
A 7-layer pipeline that runs in real time during gameplay:
1. Capture your screen + microphone
2. Detect what game you're playing
3. Detect in-game events (boss appears, low HP, level transition, etc.)
4. Combine visual + audio + game state into context
5. Look up relevant info from the game primer + memory
6. Decide if it's worth interjecting
7. Speak the tip via TTS or show it in the overlay

Two backend services keep the heavy vision work from blocking real-time audio.

### Can I use this for streaming / content creation?
Yes — it's MIT, do whatever you want. If you build a streamer overlay or Twitch integration, open an issue and I'll link to your fork.

### Does it run on Mac/Linux?
Not yet. The game window detection layer uses Windows APIs. Mac/Linux support would need a port of `frontend/gameDetection.js` to use platform-native APIs. PRs welcome.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

Built by [@stillmanish](https://github.com/stillmanish).

Standing on the shoulders of the open-source AI tooling community — Electron, Node.js, the Hugging Face ecosystem, and the AI providers (OpenAI, Google Gemini, Anthropic, Deepgram, ElevenLabs) who make this kind of project possible.
