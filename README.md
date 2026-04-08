<h1 align="center">🎮 earlygod.ai</h1>
<p align="center"><strong>The AI gaming companion that watches your screen, knows your game, and helps you get better.</strong></p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">▶️ Watch the demo</a> ·
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

**earlygod.ai** is an AI-powered desktop companion for video games. It watches your screen in real time, understands what game you're playing, knows the game's mechanics from a built-in primer, and proactively helps you when you need it — through voice, an overlay, or text. No second monitor. No paused gameplay. No friction.

- 🎯 **Auto-detects your game** — knows what you're playing without setup
- 👀 **Watches your screen** — captures gameplay, identifies in-game events (boss fights, quests, level transitions)
- 🧠 **Knows the game** — pre-loaded with primers for 13+ games (Elden Ring, Ghost of Yotei, AOE2, Black Myth: Wukong, Expedition 33, and more)
- 🗣️ **Proactive voice coaching** — interjects with tips when it detects you might need them
- 🔍 **In-context Q&A** — ask questions about the game and get instant answers grounded in the game's primer
- ⚡ **Local-first** — runs on your machine, talks to your own API keys, no telemetry, no cloud lock-in

---

## Demo

<table>
  <tr>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">
        <img src="https://img.youtube.com/vi/jgtbSzAXFtY/maxresdefault.jpg" alt="earlygod.ai demo 1" width="400">
      </a>
      <br>
      <strong>▶️ <a href="https://www.youtube.com/watch?v=jgtbSzAXFtY">Demo: Real-time gameplay coaching</a></strong>
    </td>
    <td align="center">
      <a href="https://www.youtube.com/watch?v=5UBd3aExrnU">
        <img src="https://img.youtube.com/vi/5UBd3aExrnU/maxresdefault.jpg" alt="earlygod.ai demo 2" width="400">
      </a>
      <br>
      <strong>▶️ <a href="https://www.youtube.com/watch?v=5UBd3aExrnU">Demo: Voice agent + game detection</a></strong>
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
- A Postgres database (recommended: free [Neon](https://neon.tech) tier)

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/stillmanish/earlygod-ai.git
cd earlygod-ai

# 2. Install dependencies for both backends and the frontend
cd early-god-backend && npm install && cd ..
cd boss-mode-backend && npm install && cd ..
cd frontend && npm install && cd ..

# 3. Configure API keys
cp early-god-backend/.env.example early-god-backend/.env
cp boss-mode-backend/.env.example boss-mode-backend/.env
# Open both .env files and fill in your keys

# 4. Set up the database (one-time)
# Connect to your Postgres instance and run:
# psql $DATABASE_URL < early-god-backend/database.sql

# 5. Start everything
./start.sh    # Mac/Linux
start.bat     # Windows
```

The startup script launches both backends and the Electron frontend. Press **F12** to toggle the in-game overlay.

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
| Expedition 33 | Turn-based JRPG | ⚠️ Needs rewrite |
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

## License

MIT — see [LICENSE](LICENSE).

---

## Credits

Inspired by [LudereAI](https://github.com/0xRoco/LudereAI), [Cluely](https://cluely.com), [Glass](https://github.com/topics/open-source-cluely), and the broader open-source AI assistant community.

Built by [@stillmanish](https://github.com/stillmanish).
