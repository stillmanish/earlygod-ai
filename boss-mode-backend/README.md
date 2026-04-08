# Quest Mode Backend

A separate Node.js service dedicated to vision analysis and proactive agent processing for earlygod.ai. Originally called "boss-mode-backend" and refactored into a more general quest-mode + proactive-agent service. The directory name kept its old name to preserve the existing import paths in the main app.

Runs on its own port (default 8081) and WebSocket so heavy vision analysis doesn't block the main backend's real-time audio streaming on port 3001.

## What it does

- **Quest Mode** — analyzes screenshots to track quest progress, map state, and checkpoint detection
- **Proactive Agent** — uses Gemini Vision to extract game state from screenshots and decide when to interject with helpful tips
- **Map Service** — manages game-specific map data and checkpoint history

## Setup

```bash
cd boss-mode-backend
npm install
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
node server.js
```

The service will start on port 8081 by default.

## Environment variables

See [`.env.example`](.env.example) for the full list. Required:

- `GEMINI_API_KEY` — Google Gemini API key (used for vision analysis)
- `MAIN_BACKEND_URL` — URL of the main early-god-backend (default: `http://localhost:3001`)
- `PORT` — port to run on (default: `8081`)

## Endpoints

- `GET /health` — health check
- `POST /api/proactive-agent/analyze` — analyze screenshots and return game state + suggestions
- `GET /api/map/:gameTitle/full` — get complete map data with checkpoints
- `POST /api/map/:gameTitle/refresh` — clear map cache and refresh
- `WebSocket /quest-vision/ws` — real-time quest mode session

## Health check

```bash
curl http://localhost:8081/health
```

Response:
```json
{
  "status": "healthy",
  "service": "quest-mode-backend",
  "timestamp": "2026-04-08T00:00:00.000Z"
}
```

## Architecture

This service is intentionally a separate process from `early-god-backend`. The split exists because vision analysis (passing 1080p screenshots to Gemini Vision) is expensive and would otherwise block the main backend's real-time audio streaming pipeline. Keeping them separate means:

- The main backend stays responsive for voice interactions
- Vision analysis can run on its own schedule without affecting voice latency
- Either service can be restarted independently
- They can be deployed on different machines if needed

## Deployment

This service is designed to be deployed alongside the main backend, but can run on a separate machine if desired. Set `MAIN_BACKEND_URL` to point at wherever the main backend is reachable.

For local development, just run both services on the same machine — the defaults will work.
