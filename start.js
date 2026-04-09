#!/usr/bin/env node
/**
 * earlygod.ai — cross-platform launcher
 * Spawns both backends + the Electron frontend in parallel.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

if (!fs.existsSync(ENV_PATH)) {
  console.error('❌ .env not found at repo root. Run `npm run setup` first.');
  process.exit(1);
}

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

const services = [
  { name: 'backend',  cwd: path.join(ROOT, 'early-god-backend'),  color: '\x1b[36m' },
  { name: 'quest',    cwd: path.join(ROOT, 'boss-mode-backend'),  color: '\x1b[35m' },
  { name: 'frontend', cwd: path.join(ROOT, 'frontend'),           color: '\x1b[33m' },
];

const children = services.map(({ name, cwd, color }) => {
  const child = spawn(npmCmd, ['start'], { cwd, shell: isWin });
  const prefix = `${color}[${name}]\x1b[0m`;
  child.stdout.on('data', (d) => process.stdout.write(`${prefix} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${prefix} ${d}`));
  child.on('exit', (code) => console.log(`${prefix} exited with code ${code}`));
  return child;
});

const shutdown = () => {
  console.log('\nShutting down...');
  children.forEach((c) => c.kill());
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
