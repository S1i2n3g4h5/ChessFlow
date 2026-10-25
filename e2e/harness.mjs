// Shared helpers for the browser tests. Uses the Edge or Chrome already installed on the machine
// (playwright-core, no browser download). Run with `npm run test:e2e`.
import { chromium } from 'playwright-core';
import path from 'node:path';
import fs from 'node:fs';

export const SHOTS_DIR = path.resolve('e2e', 'screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const results = [];
const consoleErrors = [];

export function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

export function summary() {
  const ignorable = (e) => /favicon|status of 40[0-9]|status of 410/.test(e);
  const real = consoleErrors.filter(e => !ignorable(e));
  check('no browser console errors or page crashes', real.length === 0, real.slice(0, 8).join(' | '));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  return failed.length === 0;
}

let browser;
export async function launchBrowser() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      browser = await chromium.launch({ channel, headless: true });
      return browser;
    } catch {
      // try the next installed browser
    }
  }
  throw new Error('Neither Microsoft Edge nor Google Chrome could be launched.');
}

/** A separate browser profile = a separate ChessFlow session (player). */
export async function newPlayer(label, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${label}] console: ${m.text()}`); });
  return { ctx, page, label, flipped: false };
}

export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });

export async function sessionOf(page) {
  return page.evaluate(() => localStorage.getItem('chessflow_session'));
}

/** Server state as seen by a member session. */
export async function stateFor(base, roomId, sessionId) {
  const res = await fetch(`${base}/api/game?roomId=${roomId}&sessionId=${sessionId}`);
  return (await res.json()).state;
}

export async function apiPost(base, body) {
  const res = await fetch(`${base}/api/game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

/** Joins a room through the UI (arena card + passcode). */
export async function joinViaUi(p, base, roomId, passcode) {
  await p.page.goto(base);
  await p.page.getByTestId('menu-online').click();
  await p.page.getByTestId(`room-card-${roomId}`).click();
  await p.page.getByTestId('passcode-input').fill(passcode);
  await p.page.getByTestId('passcode-submit').click();
}

export async function enterName(p, name) {
  await p.page.getByTestId('name-input').waitFor({ timeout: 10000 });
  await p.page.getByTestId('name-input').fill(name);
  await p.page.keyboard.press('Enter');
}

// ---------- Board geometry ----------

/** Pixel centre of grid cell (file, rank) on the board SVG (the game board, or another board via `selector`). */
export async function cellPoint(page, file, rank, flipped, selector = '[data-testid="board-svg"]') {
  return page.evaluate(([file, rank, flipped, selector]) => {
    const svg = document.querySelector(selector);
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / vw, r.height / vh);
    const offX = r.left + (r.width - vw * scale) / 2;
    const offY = r.top + (r.height - vh * scale) / 2;
    const x = flipped ? 15 - file : file;
    const y = flipped ? rank : 15 - rank;
    return { x: offX + (x - vx + 0.5) * scale, y: offY + (y - vy + 0.5) * scale };
  }, [file, rank, flipped, selector]);
}

/** Clicks a cell on the How-to-Play guide's mini board (always White's view). */
export async function clickGuideCell(page, file, rank) {
  const pt = await cellPoint(page, file, rank, false, '[data-testid="guide-board"] [data-testid="board-svg"]');
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(150);
}

/** Skips straight to the end of the guide and clicks "I'm ready". */
export async function finishGuide(p) {
  await p.page.getByTestId('guide').waitFor({ timeout: 10000 });
  await p.page.getByTestId('guide-skip').click();
  await p.page.getByTestId('guide-ready').click();
}

export async function clickCell(p, file, rank) {
  const pt = await cellPoint(p.page, file, rank, p.flipped);
  await p.page.mouse.click(pt.x, pt.y);
  await p.page.waitForTimeout(120);
}

export async function moveTo(p, from, to) {
  await clickCell(p, ...from);
  await clickCell(p, ...to);
}

export const moveList = (page) =>
  page.getByTestId('move-item').evaluateAll(items => items.map(i => i.textContent.trim()));

export async function waitForMoves(page, n, timeout = 8000) {
  await page.waitForFunction(n => document.querySelectorAll('[data-testid="move-item"]').length >= n, n, { timeout });
}

export const ghostCount = (page) => page.evaluate(() =>
  document.querySelector('[data-testid="board-svg"]').querySelectorAll('[data-kind="expansion-target"]').length);

export const viewBoxOf = (page) => page.getByTestId('board-svg').getAttribute('viewBox');

export async function boardFitsFrame(page) {
  return page.evaluate(() => {
    const s = document.querySelector('[data-testid="board-svg"]').getBoundingClientRect();
    const f = document.querySelector('[data-testid="board-frame"]').getBoundingClientRect();
    const tol = 1.5;
    return {
      fits: s.left >= f.left - tol && s.top >= f.top - tol && s.right <= f.right + tol && s.bottom <= f.bottom + tol,
      svg: [s.left, s.top, s.width, s.height].map(Math.round),
      frame: [f.left, f.top, f.width, f.height].map(Math.round),
    };
  });
}

/** Is a piece drawn over grid cell (file, rank)? */
export async function pieceOn(p, file, rank) {
  const pt = await cellPoint(p.page, file, rank, p.flipped);
  return p.page.evaluate(({ x, y }) => {
    const svg = document.querySelector('[data-testid="board-svg"]');
    return [...svg.querySelectorAll(':scope > g')].filter(g => g.querySelector('svg')).some(g => {
      const r = g.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
  }, pt);
}

// ---------- Performance probes ----------

/** Starts recording main-thread long tasks (> 50 ms) in the page. */
export async function startLongTaskProbe(page) {
  await page.evaluate(() => {
    window.__longTasks = [];
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__longTasks.push(Math.round(e.duration));
    }).observe({ type: 'longtask', buffered: false });
  });
}

export const longTasks = (page) => page.evaluate(() => window.__longTasks || []);

/** Measures, inside the page, the time from the next click to the move list growing. */
export async function armMoveLatencyProbe(page) {
  await page.evaluate(() => {
    window.__moveLatency = null;
    const list = document.querySelector('[data-testid="move-list"]');
    const before = list.children.length;
    let clickedAt = null;
    document.addEventListener('pointerdown', () => { clickedAt = performance.now(); }, { capture: true });
    new MutationObserver((_, obs) => {
      if (list.children.length > before && clickedAt !== null) {
        window.__moveLatency = Math.round(performance.now() - clickedAt);
        obs.disconnect();
      }
    }).observe(list, { childList: true });
  });
}

export const moveLatency = (page) => page.evaluate(() => window.__moveLatency);
