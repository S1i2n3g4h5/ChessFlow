// Browser test runner: starts the production build (`next build` first, see npm run test:e2e),
// runs every suite in a real Edge/Chrome, then stops the servers.
//   node e2e/run.mjs            all suites
//   node e2e/run.mjs online     only the named suites
import { spawn } from 'node:child_process';
import path from 'node:path';
import { launchBrowser, summary } from './harness.mjs';
import { onlineSuite } from './online.mjs';
import { securitySuite } from './security.mjs';
import { layoutSuite } from './layout.mjs';
import { expirySuite, EXPIRY_TEST_LIMIT_MS } from './expiry.mjs';
import { computerSuite } from './computer.mjs';

const NEXT_BIN = path.resolve('node_modules', 'next', 'dist', 'bin', 'next');
const servers = [];

async function startServer(port, env = {}) {
  const child = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(port)], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(child);
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/api/game`);
      if (res.ok) return base;
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Server on port ${port} did not start`);
}

const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.includes(name);

let ok = false;
try {
  const base = await startServer(3210);
  await launchBrowser();

  if (wanted('security')) {
    console.log('\n== security ==');
    await securitySuite(base);
  }
  if (wanted('online')) {
    console.log('\n== online ==');
    await onlineSuite(base);
  }
  if (wanted('layout')) {
    console.log('\n== layout ==');
    await layoutSuite(base);
  }
  if (wanted('computer')) {
    console.log('\n== computer ==');
    await computerSuite(base);
  }
  if (wanted('expiry')) {
    console.log('\n== expiry (10 s inactivity limit) ==');
    const expiryBase = await startServer(3211, { CHESSFLOW_ROOM_IDLE_MS: String(EXPIRY_TEST_LIMIT_MS) });
    await expirySuite(expiryBase);
  }
  ok = summary();
} catch (e) {
  console.error('E2E run crashed:', e);
} finally {
  for (const s of servers) s.kill();
}
process.exit(ok ? 0 : 1);
