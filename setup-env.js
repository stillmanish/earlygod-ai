#!/usr/bin/env node
/**
 * earlygod.ai — Interactive setup
 *
 * Prompts for the API keys you need to run the app and writes them
 * to .env at the repo root. Run with: `npm run setup`
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '.env');
const EXAMPLE_PATH = path.join(__dirname, '.env.example');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log('\n🎮 earlygod.ai — interactive setup\n');

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = (await ask('.env already exists. Overwrite? [y/N] ')).trim().toLowerCase();
    if (overwrite !== 'y') {
      console.log('Aborted. Existing .env left untouched.');
      rl.close();
      return;
    }
  }

  console.log('You need AT LEAST ONE AI provider. Press Enter to skip any key.\n');

  console.log('AI provider — pick one:');
  console.log('  1. OpenAI    — https://platform.openai.com/api-keys');
  console.log('  2. Gemini    — https://aistudio.google.com/apikey  (best free option)');
  console.log('  3. Anthropic — https://console.anthropic.com\n');

  const openai = (await ask('OPENAI_API_KEY     (or skip): ')).trim();
  const gemini = (await ask('GEMINI_API_KEY     (or skip): ')).trim();
  const anthropic = (await ask('ANTHROPIC_API_KEY  (or skip): ')).trim();

  if (!openai && !gemini && !anthropic) {
    console.log('\n⚠️  No AI provider set. You need at least one to run the app.');
  }

  console.log('\nVoice services (required for voice features):');
  console.log('  Deepgram   — https://console.deepgram.com/   ($200 free credit)');
  console.log('  ElevenLabs — https://elevenlabs.io/app/settings/api-keys\n');

  const deepgram = (await ask('DEEPGRAM_API_KEY:   ')).trim();
  const elevenlabs = (await ask('ELEVENLABS_API_KEY: ')).trim();

  console.log('\nDatabase (optional — leave empty for SQLite fallback):');
  const dbUrl = (await ask('DATABASE_URL (Postgres, e.g. from Neon): ')).trim();

  rl.close();

  const template = fs.readFileSync(EXAMPLE_PATH, 'utf8');
  const replacements = {
    OPENAI_API_KEY: openai,
    GEMINI_API_KEY: gemini,
    ANTHROPIC_API_KEY: anthropic,
    DEEPGRAM_API_KEY: deepgram,
    ELEVENLABS_API_KEY: elevenlabs,
    DATABASE_URL: dbUrl,
  };

  let output = template;
  for (const [key, value] of Object.entries(replacements)) {
    if (value) {
      const re = new RegExp(`^${key}=.*$`, 'm');
      output = output.replace(re, `${key}=${value}`);
    }
  }

  fs.writeFileSync(ENV_PATH, output);
  console.log(`\n✅ Wrote .env to ${ENV_PATH}`);
  console.log('\nNext: run the app with `./start.sh` (Mac/Linux) or `start.bat` (Windows).');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  rl.close();
  process.exit(1);
});
