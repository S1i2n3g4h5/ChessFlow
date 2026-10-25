/**
 * Bot-vs-bot balance experiments for the report.
 *
 *   npm run simulate                         # defaults: 300 self-play + 200 comparison games
 *   npm run simulate -- --self 100 --compare 60 --shards 6
 *   npm run simulate -- --report-only        # rebuild the report from docs/balance/results.json
 *
 * Writes docs/balance/results.json, docs/balance/*.svg and docs/balance-report.md.
 * Games run in parallel child processes ("shards"); each game is reproducible from its seed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotSpec, GameRecord, playGame, RANDOM_OPENING_PLIES, ADJUDICATION_CP } from './balance/simulate-core';
import { writeReport } from './balance/report';

interface Job { experiment: 'self' | 'compare'; seed: number; white: BotSpec; black: BotSpec }
type Result = GameRecord & { experiment: Job['experiment'] };

const NODES = 6000;
const MAX_PLIES = 200;
const AWARE: BotSpec = { label: 'Expansion-aware', maxNodes: NODES };
const NEVER: BotSpec = { label: 'Never expands', maxNodes: NODES, noExpansions: true };

const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

// ---------- child process: play the jobs it was given ----------
if (args[0] === '--child') {
  const jobs: Job[] = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const out: Result[] = [];
  for (const job of jobs) {
    out.push({ ...playGame(job.seed, job.white, job.black, MAX_PLIES), experiment: job.experiment });
    process.stdout.write('.');
  }
  fs.writeFileSync(args[2], JSON.stringify(out));
  process.exit(0);
}

// ---------- regenerate the report from saved results (no games played) ----------
if (args[0] === '--report-only') {
  const saved = JSON.parse(fs.readFileSync(path.resolve('docs', 'balance', 'results.json'), 'utf8'));
  writeReport(saved.games, saved.meta);
  process.exit(0);
}

// ---------- main process ----------
const selfGames = arg('self', 300);
const compareGames = arg('compare', 200);
const shards = Math.max(1, Math.min(arg('shards', Math.max(1, os.cpus().length - 2)), 32));

const jobs: Job[] = [];
for (let i = 1; i <= selfGames; i++) jobs.push({ experiment: 'self', seed: i, white: AWARE, black: AWARE });
for (let i = 1; i <= compareGames; i++) {
  // Colors alternate so neither bot benefits from moving first
  const awareWhite = i % 2 === 1;
  jobs.push({ experiment: 'compare', seed: 10_000 + i, white: awareWhite ? AWARE : NEVER, black: awareWhite ? NEVER : AWARE });
}

const scriptPath = fileURLToPath(import.meta.url);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chessflow-sim-'));
const started = Date.now();
console.log(`Playing ${jobs.length} games (${selfGames} self-play, ${compareGames} comparison) on ${shards} processes...`);

const parts = Array.from({ length: shards }, (_, k) => jobs.filter((_, i) => i % shards === k));
const results: Result[] = (await Promise.all(parts.map((part, k) => new Promise<Result[]>((resolve, reject) => {
  const jobFile = path.join(tmp, `jobs-${k}.json`);
  const outFile = path.join(tmp, `out-${k}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(part));
  const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, '--child', jobFile, outFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  child.stdout.on('data', d => process.stdout.write(d));
  child.on('exit', code => (code === 0 ? resolve(JSON.parse(fs.readFileSync(outFile, 'utf8'))) : reject(new Error(`shard ${k} failed`))));
})))).flat();

const minutes = (Date.now() - started) / 60000;
console.log(`\nDone in ${minutes.toFixed(1)} min.`);
fs.rmSync(tmp, { recursive: true, force: true });

writeReport(results, {
  nodesPerMove: NODES,
  maxPlies: MAX_PLIES,
  randomOpeningPlies: RANDOM_OPENING_PLIES,
  adjudicationCp: ADJUDICATION_CP,
  minutes,
  shards,
});
