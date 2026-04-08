# Changelog

## v1.0.0 — 2026-04-08

Initial public release. Reference implementation of the gaming AI companion that ran in production for months as a private app.

### Features

- 🎮 7-layer real-time AI processing pipeline (input → game detection → event detection → context fusion → memory → reasoning → output)
- 🎯 Auto game detection for 13+ pre-loaded games
- 🗣️ Real-time voice coaching via Deepgram (STT) + ElevenLabs (TTS)
- 🧠 In-context Q&A grounded in local game primer files
- 👀 Screen capture + event detection (boss fights, quests, deaths)
- 🔌 Pluggable AI provider (OpenAI / Gemini / Anthropic)
- 🔐 Optional Clerk auth — easily swappable for any other auth provider

### Changes from internal version

- Removed Google Cloud Vertex AI Vector Search; replaced with local file-based search over game primers (no GCP setup required)
- Removed Vertex AI fine-tuned model support (made optional via try/catch import)
- Removed all hardcoded production URLs (Railway, Neon DB, etc.); replaced with localhost defaults + env var overrides
- Removed proprietary `earlygod-railway-key.json` service account credentials
- Made Clerk auth a removable harness (uninstall the package to run in no-auth mode)
- Removed 70+ internal dev notes and refactor logs
- Removed beta distribution build artifacts and binaries
- Added comprehensive `.env.example` files for both backends
- Added MIT license, CONTRIBUTING, SECURITY, and proper README
