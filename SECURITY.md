# Security Policy

## Reporting a vulnerability

If you find a security issue in earlygod.ai, please **do not** open a public GitHub issue. Instead:

1. Open a [private security advisory](https://github.com/stillmanish/earlygod-ai/security/advisories/new) on GitHub, or
2. Email the maintainer directly

I'll do my best to respond, but note that this project is a **reference implementation** and is not actively maintained. For critical issues, your best path may be to fix it in a fork and share the patch.

## What counts as a security issue

- Code execution vulnerabilities
- Credential leakage (API keys, tokens, database URLs)
- Path traversal, SQL injection, XSS in any of the backends or frontend
- Authentication/authorization bypasses (if you've enabled Clerk)
- Anything that would let a malicious game (or screenshot of a malicious game) compromise the user's machine

## What is NOT a security issue

- Bugs that crash the app but don't expose data
- Missing rate limits (this is a single-user local app)
- "User must configure their own API keys" (by design)
- "Anti-cheat may flag this in competitive games" (this is documented in the README)

## Privacy

earlygod.ai runs entirely on your machine. Screen captures, voice, and game data are sent only to the API providers you configure (OpenAI/Gemini/Deepgram/ElevenLabs/your own database). The maintainer collects no telemetry. There is no analytics server. There is no cloud sync.

If you find any code that contradicts this — please report it as a security issue.
