// Games against the computer opponent: everything runs in the browser (no server requests).
import {
  armMoveLatencyProbe, check, finishGuide, longTasks, moveLatency, moveList, moveTo, newPlayer, pieceOn, shot,
  startLongTaskProbe, waitForMoves,
} from './harness.mjs';

async function startComputerGame(p, base, { level, color, time }) {
  await p.page.goto(base);
  await p.page.getByTestId('menu-computer').click();
  await p.page.getByTestId(`level-${level}`).click();
  await p.page.getByTestId(`color-${color}`).click();
  await p.page.getByTestId(`time-${time}`).click();
  await p.page.getByTestId('start-computer').click();
  await p.page.getByTestId('board-svg').first().waitFor({ timeout: 10000 });
}

const text = (page, id) => page.getByTestId(id).first().textContent();
const seconds = (clock) => { const [m, s] = clock.split(':').map(Number); return m * 60 + s; };

export async function computerSuite(BASE) {
  const P = await newPlayer('computer');
  let apiCalls = 0;
  P.page.on('request', req => { if (req.url().includes('/api/game')) apiCalls++; });

  // ---------- Easy, as White, untimed ----------
  // How to Play from the menu
  await P.page.goto(BASE);
  await P.page.getByTestId('menu-guide').waitFor();
  await shot(P.page, 'home-menu');
  await P.page.getByTestId('menu-guide').click();
  await P.page.getByTestId('guide').waitFor({ timeout: 5000 });
  check('the menu opens the How-to-Play guide', true);
  await P.page.getByTestId('guide-close').click();

  await startComputerGame(P, BASE, { level: 'EASY', color: 'WHITE', time: 'untimed' });
  check('setup screen starts a computer game', true);
  check('a first-time player gets the guide before the first computer game', await P.page.getByTestId('guide').isVisible());
  await finishGuide(P);
  check('mode label shows level and clock', (await text(P.page, 'mode-label')).includes('vs Computer · Easy · Untimed'), await text(P.page, 'mode-label'));
  const botName = await P.page.getByTestId('player-tag-top').getByTestId('player-name').textContent();
  check('the opponent is named ChessFlow AI · Easy', botName === 'ChessFlow AI · Easy', botName);
  check('untimed games show "Untimed" instead of a clock', (await P.page.getByTestId('player-tag-top').getByTestId('player-clock').textContent()).trim() === 'Untimed');

  await startLongTaskProbe(P.page);
  await armMoveLatencyProbe(P.page);
  await moveTo(P, [8, 5], [8, 7]); // e4
  await waitForMoves(P.page, 1);
  check('your move appears instantly (< 100 ms)', (await moveLatency(P.page)) < 100, `${await moveLatency(P.page)} ms`);
  await P.page.getByTestId('bot-thinking').waitFor({ timeout: 3000 });
  check('a thinking indicator shows while the computer searches', true);
  const t0 = Date.now();
  await waitForMoves(P.page, 2, 10000);
  const replyMs = Date.now() - t0;
  check('the computer replies (Easy, within 2 s)', replyMs < 2000, `${replyMs} ms`);
  const tasks = await longTasks(P.page);
  check('the page never freezes while the computer thinks (no task > 100 ms)', tasks.every(t => t <= 100), JSON.stringify(tasks));
  check('no server requests are made in a computer game', apiCalls === 0, `${apiCalls} requests`);

  // Undo takes back both moves
  await P.page.getByTestId('cmd-undo').click();
  await P.page.waitForFunction(() => document.querySelectorAll('[data-testid="move-item"]').length === 0, null, { timeout: 5000 });
  await P.page.waitForTimeout(900);
  check('undo takes back your move and the computer\'s reply', await pieceOn(P, 8, 5));
  check('undo is disabled when there is nothing to take back', await P.page.getByTestId('cmd-undo').isDisabled());

  await moveTo(P, [8, 5], [8, 7]);
  await waitForMoves(P.page, 2, 10000);
  const before = await moveList(P.page);

  // Draw offer at an equal position: declined
  await P.page.getByTestId('cmd-offer-draw').click();
  await P.page.getByTestId('notice').waitFor({ timeout: 8000 });
  check('the computer answers a draw offer (declined when level)', (await text(P.page, 'notice')).includes('declined'), await text(P.page, 'notice'));

  // Reload: the game is still there
  await P.page.reload();
  await P.page.getByTestId('menu-resume').waitFor({ timeout: 8000 });
  check('after a reload the menu offers to resume the computer game', (await text(P.page, 'menu-resume')).includes('Easy'));
  await P.page.getByTestId('menu-resume').click();
  await waitForMoves(P.page, 2);
  check('resuming restores the same moves', JSON.stringify(await moveList(P.page)) === JSON.stringify(before), JSON.stringify(await moveList(P.page)));
  await shot(P.page, 'computer-easy');

  // Resign, then New Game goes back to the setup screen
  await P.page.getByTestId('cmd-resign').click();
  await P.page.getByTestId('cmd-resign').click();
  await P.page.getByTestId('game-over').waitFor({ timeout: 5000 });
  check('resigning ends the computer game', await P.page.getByText('by resignation').isVisible());
  check('undo is not offered after resigning', await P.page.getByTestId('cmd-undo').isDisabled());
  await P.page.getByTestId('overlay-new-game').click();
  await P.page.getByTestId('computer-setup').waitFor({ timeout: 5000 });
  check('New Game opens the setup screen', true);

  // ---------- Medium, as Black, 10 minutes ----------
  await P.page.getByTestId('level-MEDIUM').click();
  await P.page.getByTestId('color-BLACK').click();
  await P.page.getByTestId('time-600').click();
  await P.page.getByTestId('start-computer').click();
  await P.page.getByTestId('board-svg').first().waitFor({ timeout: 10000 });
  check('after the guide has been seen, the next computer game starts straight away', !(await P.page.getByTestId('guide').isVisible()));
  await startLongTaskProbe(P.page);
  const bottomName = await P.page.getByTestId('player-tag-bottom').getByTestId('player-name').textContent();
  check('playing Black puts you at the bottom', bottomName !== 'ChessFlow AI · Medium', bottomName);
  const t1 = Date.now();
  await waitForMoves(P.page, 1, 10000);
  const firstMoveMs = Date.now() - t1;
  check('the computer opens as White (Medium, within 2.5 s)', firstMoveMs < 2500, `${firstMoveMs} ms`);
  check('no freeze during a Medium search either', (await longTasks(P.page)).every(t => t <= 100), JSON.stringify(await longTasks(P.page)));
  const myClockStart = (await P.page.getByTestId('player-tag-bottom').getByTestId('player-clock').textContent()).trim();
  await P.page.waitForTimeout(2300);
  const myClockLater = (await P.page.getByTestId('player-tag-bottom').getByTestId('player-clock').textContent()).trim();
  check('your clock runs on your turn', seconds(myClockStart) >= 599 && seconds(myClockLater) <= seconds(myClockStart) - 2, `${myClockStart} -> ${myClockLater}`);
  // The display rounds up to whole seconds, so read the exact saved milliseconds
  const botMs = await P.page.evaluate(() => JSON.parse(localStorage.getItem('chessflow_computer_game')).clocksMs.WHITE);
  check("the computer's thinking time came off its clock", botMs < 600000 && botMs > 590000, `${botMs} ms left`);
  await shot(P.page, 'computer-medium-black');

  // ---------- 3-hour rule (test override: 3 s) ----------
  await P.page.evaluate(() => localStorage.setItem('chessflow_test_idle_ms', '3000'));
  await P.page.getByTestId('menu-notice').waitFor({ timeout: 10000 });
  check('an idle computer game is closed and you are told why', (await text(P.page, 'menu-notice')).includes('3 hours'), await text(P.page, 'menu-notice'));
  check('the closed game cannot be resumed', (await P.page.getByTestId('menu-resume').count()) === 0);
  await P.page.evaluate(() => localStorage.removeItem('chessflow_test_idle_ms'));
  await P.ctx.close();

  // ---------- Phone-sized setup screen ----------
  const M = await newPlayer('computer-mobile', { width: 390, height: 844 });
  await M.page.goto(BASE);
  await M.page.getByTestId('menu-computer').click();
  await M.page.getByTestId('computer-setup').waitFor();
  check('setup screen fits a phone (no sideways scroll)', await M.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await shot(M.page, 'computer-setup-mobile');
  await M.ctx.close();
}
