# Contributing to earlygod.ai

Thanks for your interest! This is a **reference implementation** released as open source. PRs are welcome but I am **not actively maintaining** this project, so please:

1. **Don't expect prompt review.** I may take days, weeks, or months to look at a PR. Or never.
2. **Forks are encouraged.** If you want to take this further or build on top of it, the easiest path is to fork it and make it yours.
3. **Don't open large refactor PRs.** I'm unlikely to merge them. Small, focused changes are far more likely to land.

## Easiest contribution: add a game primer

The single most useful thing you can do is **add a game primer** for a game you love.

A game primer is a JSON file in `frontend/game-primers/` that teaches earlygod.ai about a specific game's mechanics, terminology, and tips. It takes about 30 minutes to write a good one.

**To add a primer:**

1. Copy an existing primer as a template (e.g. `elden-ring.json`)
2. Rename it to `your-game.json` (lowercase, hyphens, no spaces)
3. Fill in the fields:
   - `gameTitle` — exact game name
   - `genre`, `developer`, `releaseDate`, `platforms`
   - `overview` — 1-2 sentence summary
   - `coreMechanics` — bullet list
   - `terminology` — game-specific term → plain-language definition
   - `tips`, `bossStrategies`, `commonMistakes`, etc.
4. Test it: launch earlygod.ai with the game running, ask the assistant a question
5. Open a PR with just the new file

**Important:** All content must be **original**. Do not copy from Fextralife, IGN, GameFAQs, official strategy guides, or any other copyrighted source. Paraphrase in your own words. Stick to facts (mechanics, stats, names) which aren't copyrightable.

## Other contributions

- 🐛 **Bug fixes** — small, focused fixes are welcome
- 📝 **Documentation improvements** — typos, clarifications, examples
- 🌍 **Mac/Linux ports** — game window detection currently uses Windows APIs. PRs to abstract the platform layer are welcome.
- 🔌 **New AI provider integrations** — add support for additional LLM/STT/TTS providers
- 🔐 **Auth provider examples** — show how to swap Clerk for Auth0, Supabase, Firebase, etc.

## What I will NOT merge

- Features that require my services (cloud sync, paid API endpoints, telemetry to my server)
- Anti-cheat bypass code or features that would help users cheat in competitive online games
- Scraped content from copyrighted sources
- Massive architectural rewrites
- Code that breaks existing functionality without a strong justification

## Code of conduct

Be kind. Don't be a jerk. If you wouldn't say it in person, don't write it in an issue.

## License

By contributing, you agree your contributions will be licensed under the MIT License.
