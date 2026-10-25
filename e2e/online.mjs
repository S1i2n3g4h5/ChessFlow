// Two players + a spectator play through a full online game in Arena Alpha.
import {
  apiPost, armMoveLatencyProbe, boardFitsFrame, check, clickCell, clickGuideCell, enterName, finishGuide, ghostCount, joinViaUi,
  moveLatency, moveList, moveTo, newPlayer, pieceOn, sessionOf, shot, stateFor, viewBoxOf, waitForMoves,
} from './harness.mjs';

export async function onlineSuite(BASE) {
  const ROOM = 'ALPHA';

  // ---------- Room selection + lobby ----------
  const A = await newPlayer('A');
  await joinViaUi(A, BASE, ROOM, 'wrong');
  await A.page.getByTestId('passcode-error').waitFor({ timeout: 5000 });
  check('wrong passcode is rejected by the server', await A.page.getByTestId('passcode-error').isVisible());
  await A.page.getByTestId('passcode-input').fill('archon');
  await A.page.getByTestId('passcode-submit').click();
  await A.page.getByTestId('lobby').waitFor({ timeout: 10000 });
  check('first player waits in the lobby', true);
  check('room is written to the URL', A.page.url().includes('room=ALPHA'));
  const sidA = await sessionOf(A.page);

  await A.page.waitForTimeout(3500); // alone in the lobby: the clock must not run
  let s = await stateFor(BASE, ROOM, sidA);
  check('clock does not run while waiting in the lobby', s.clocks.WHITE === 1800, `WHITE=${s.clocks.WHITE}`);

  // Player B uses the direct link: it must still ask for the passcode
  const B = await newPlayer('B');
  await B.page.goto(`${BASE}/?room=ALPHA`);
  await B.page.getByTestId('passcode-input').waitFor({ timeout: 10000 });
  check('a direct room link still asks for the passcode', true);
  await B.page.getByTestId('passcode-input').fill('ARCHON');
  await B.page.getByTestId('passcode-submit').click();

  // ---------- Names ----------
  await enterName(A, 'ALICE');
  await enterName(B, 'BOBBY');
  await A.page.waitForSelector('text=BOBBY', { timeout: 10000 });
  await B.page.waitForSelector('text=ALICE', { timeout: 10000 });
  check("both players see each other's names", true);
  B.flipped = true;
  s = await stateFor(BASE, ROOM, sidA);
  check('names are not logged as moves', s.history.length === 0 && s.notation.length === 0);
  check('page title is ChessFlow', (await A.page.title()) === 'ChessFlow', await A.page.title());

  // ---------- Reload keeps the seat ----------
  await A.page.reload();
  await A.page.getByTestId('board-svg').waitFor({ timeout: 10000 });
  await A.page.waitForTimeout(1500);
  const bottomName = await A.page.getByTestId('player-tag-bottom').getByTestId('player-name').textContent();
  check('reloading the page rejoins the same seat without a passcode', bottomName === 'ALICE' && !(await A.page.getByTestId('passcode-input').isVisible()), String(bottomName));

  // ---------- Spectator ----------
  const C = await newPlayer('C');
  await joinViaUi(C, BASE, ROOM, 'archon');
  await C.page.getByTestId('spectator-badge').waitFor({ timeout: 10000 });
  check('third visitor becomes a spectator', true);
  check('spectator cannot resign', await C.page.getByTestId('cmd-resign').isDisabled());
  check('spectator sees that the players are getting ready', await C.page.getByTestId('ready-spectator').isVisible());

  // ---------- How-to-Play guide + ready gate ----------
  await A.page.getByTestId('guide').waitFor({ timeout: 10000 });
  await B.page.getByTestId('guide').waitFor({ timeout: 10000 });
  check('both players get the How-to-Play guide when the game is about to start', true);
  check('the guide starts at step 1', (await A.page.getByTestId('guide-progress').textContent()).includes('Step 1 of 8'));
  await A.page.getByTestId('guide-next').click();
  await A.page.getByTestId('guide-next').click(); // skip the "move" task
  check('the guide moves on step by step', (await A.page.getByTestId('guide-title').textContent()).includes('grow the board'));
  await clickGuideCell(A.page, 3, 7); // expand on the mini board
  await A.page.waitForTimeout(300);
  check('the mini board is playable: expanding completes the step', (await A.page.getByTestId('guide-task').getAttribute('data-done')) === 'true');
  await A.page.keyboard.press('ArrowRight');
  check('arrow keys navigate the guide', (await A.page.getByTestId('guide-title').textContent()).includes('settle'));
  await shot(A.page, 'guide-step');
  await A.page.getByTestId('guide-skip').click();
  await A.page.getByTestId('guide-ready').click();
  await A.page.getByTestId('ready-waiting').waitFor({ timeout: 8000 });
  check("after \"I'm ready\" the first player waits for the opponent", (await A.page.getByTestId('ready-waiting').textContent()).includes('BOBBY'));
  await A.page.waitForTimeout(2500);
  s = await stateFor(BASE, ROOM, sidA);
  check('the clock does not start until both players are ready', s.clocks.WHITE === 1800 && s.ready.WHITE && !s.ready.BLACK, `WHITE=${s.clocks.WHITE}`);
  const early = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: sidA, action: { type: 'EXPAND', cellId: '3,7' } });
  check('the server refuses moves until both players are ready', early.status === 409, String(early.status));
  await finishGuide(B);
  await A.page.waitForFunction(() => !document.querySelector('[data-testid="ready-card"]'), null, { timeout: 8000 });
  check('once both are ready the game starts for both players', !(await B.page.getByTestId('ready-card').isVisible()) && !(await B.page.getByTestId('guide').isVisible()));

  // ---------- Board fits its frame ----------
  const fitA = await boardFitsFrame(A.page);
  check('desktop 1440x900: board is fully inside its frame', fitA.fits, JSON.stringify(fitA));
  check('initial view box is the full grid', (await viewBoxOf(A.page)) === '0 0 16 16');
  check('30 expansion cells offered to White at the start', (await ghostCount(A.page)) === 30, String(await ghostCount(A.page)));

  // ---------- Moves, expansion, stabilization ----------
  await armMoveLatencyProbe(A.page);
  await moveTo(A, [8, 5], [8, 7]); // 1. e4
  await waitForMoves(A.page, 1);
  const latency = await moveLatency(A.page);
  check('own move appears instantly (click to board update < 100 ms)', latency !== null && latency < 100, `${latency} ms`);
  await waitForMoves(B.page, 1);
  check('White e2-e4 shows as "i8" for Black', (await moveList(B.page))[0] === 'i8', JSON.stringify(await moveList(B.page)));

  await B.page.waitForTimeout(300);
  await clickCell(B, 7, 12); // 1... expand above d8
  await waitForMoves(A.page, 2);
  s = await stateFor(BASE, ROOM, sidA);
  check('Black expansion recorded as "Exp h13"', s.notation[1] === 'Exp h13', JSON.stringify(s.notation));
  check('new cell is stabilizing for Black', s.board['7,12'].active && s.board['7,12'].stabilizingUntil === 'BLACK');

  await moveTo(A, [9, 4], [6, 7]); // 2. Bc4
  await waitForMoves(B.page, 3);
  s = await stateFor(BASE, ROOM, sidA);
  check("stabilization cleared on Black's next turn", s.board['7,12'].stabilizingUntil === null);

  await B.page.waitForTimeout(300);
  await moveTo(B, [7, 11], [7, 12]); // 2... Q to the new cell
  await waitForMoves(A.page, 4);
  check('Black queen uses its own expanded cell: "Qh13"', (await moveList(A.page))[3] === 'Qh13', JSON.stringify(await moveList(A.page)));

  await A.page.waitForTimeout(300);
  await moveTo(A, [6, 7], [9, 10]); // 3. Bxf7+
  await waitForMoves(B.page, 5);
  await B.page.waitForTimeout(300);
  check('check is written with "+"', (await moveList(B.page))[4] === 'Bxj11+', JSON.stringify(await moveList(B.page)));
  check('no expansion cells are offered while in check', (await ghostCount(B.page)) === 0, String(await ghostCount(B.page)));
  const checkMarker = await B.page.evaluate(() => Boolean(document.querySelector('[data-testid="board-svg"] [data-kind="check"]')));
  check('king in check is highlighted', checkMarker);
  await shot(B.page, 'black-in-check');

  await clickCell(B, 3, 7); // trying to expand while in check: nothing happens
  await B.page.waitForTimeout(1200);
  s = await stateFor(BASE, ROOM, sidA);
  check('expanding while in check is impossible from the UI', s.history.length === 5, `history=${s.history.length}`);

  // Hand-crafted requests during Black's turn: the server refuses both
  const sidB = await sessionOf(B.page);
  const whitePawn = Object.values(s.pieces).find(p => p.owner === 'WHITE' && p.type === 'PAWN' && p.cellId === '4,5');
  const pawnMove = { type: 'MOVE', pieceId: whitePawn.id, toCellId: '4,6' };
  const outOfTurn = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: sidA, action: pawnMove });
  check("server rejects White moving on Black's turn", outOfTurn.status === 403 && outOfTurn.data.error === 'NOT_YOUR_TURN', `${outOfTurn.status} ${outOfTurn.data?.error}`);
  const wrongPiece = await apiPost(BASE, { op: 'action', roomId: ROOM, sessionId: sidB, action: pawnMove });
  check("server rejects Black moving one of White's pieces", wrongPiece.status === 422 && wrongPiece.data.error === 'ILLEGAL_ACTION', `${wrongPiece.status} ${wrongPiece.data?.error}`);

  await moveTo(B, [8, 11], [9, 10]); // 3... Kxf7
  await waitForMoves(A.page, 6);
  check('king recaptures: "Kxj11"', (await moveList(A.page))[5] === 'Kxj11', JSON.stringify(await moveList(A.page)));

  // ---------- Move list pairing + playback ----------
  const listText = await A.page.getByTestId('move-list').evaluate(el => [...el.children].map(c => c.textContent.trim()));
  check('move list rows are paired White/Black', JSON.stringify(listText) === JSON.stringify(['1', 'i8', 'Exp h13', '2', 'Bg8', 'Qh13', '3', 'Bxj11+', 'Kxj11']), JSON.stringify(listText));

  await A.page.getByTestId('move-item').first().click();
  await A.page.getByTestId('back-to-live').waitFor();
  check('clicking a move opens that position', true);
  await A.page.getByTestId('playback-start').click();
  await A.page.waitForTimeout(1200);
  check('start position button shows the starting board', await pieceOn(A, 8, 5));
  await A.page.getByTestId('playback-next').click();
  await A.page.getByTestId('playback-next').click();
  const active = () => A.page.evaluate(() => document.querySelector('[data-testid="move-item"][data-active="true"]')?.textContent);
  check('next-move button steps one move at a time', (await active()) === 'Exp h13', String(await active()));
  await A.page.getByTestId('playback-live').click();
  await A.page.getByTestId('playback-prev').click();
  check('previous-move from live goes back exactly one move', (await active()) === 'Bxj11+', String(await active()));
  await A.page.getByTestId('back-to-live').click();

  s = await stateFor(BASE, ROOM, sidA);
  check('clocks run once both players are named', s.clocks.WHITE < 1800, `WHITE=${s.clocks.WHITE} BLACK=${s.clocks.BLACK}`);

  // ---------- Locked view for Black after an off-centre expansion ----------
  await A.page.waitForTimeout(300);
  await clickCell(A, 12, 6); // 4. White expands right of h3
  await waitForMoves(B.page, 7);
  await B.page.getByTestId('cmd-view-lock').click();
  await B.page.waitForTimeout(700);
  const vbLocked = await viewBoxOf(B.page);
  check('Black locked view frames the board', vbLocked === '1 2 13 13', vbLocked);
  const fitB = await boardFitsFrame(B.page);
  check('Black locked view is fully inside its frame', fitB.fits, JSON.stringify(fitB));
  await shot(B.page, 'black-locked-view');
  await B.page.getByTestId('cmd-view-lock').click();

  // ---------- Reset is refused mid-game ----------
  const midReset = await apiPost(BASE, { op: 'reset', roomId: ROOM, sessionId: sidB });
  check('a new game cannot be forced while a game is in progress', midReset.status === 409, String(midReset.status));

  // ---------- Resign ----------
  await A.page.getByTestId('cmd-resign').click();
  check('resign asks for confirmation first', (await A.page.getByTestId('cmd-resign').textContent()) === 'Click again to resign');
  s = await stateFor(BASE, ROOM, sidA);
  check('first click does not resign', s.status === 'ONGOING');
  await A.page.getByTestId('cmd-resign').click();
  await B.page.getByTestId('game-over').waitFor({ timeout: 10000 });
  check('both players see the result', await A.page.getByText('BOBBY wins', { exact: true }).isVisible());
  check('result explains the reason', await B.page.getByText('Black wins by resignation').isVisible());
  await C.page.waitForSelector('text=Waiting for the players to start a new game', { timeout: 10000 });
  check('spectator sees the result but cannot start a new game', true);
  await shot(A.page, 'game-over');

  await A.page.getByTestId('overlay-review').click();
  await A.page.waitForTimeout(300);
  check('Review Board closes the result overlay', !(await A.page.getByTestId('game-over').isVisible()));
  check('sidebar offers a new game after the end', await A.page.getByTestId('cmd-new-game').isVisible());

  // ---------- New game ----------
  await B.page.getByTestId('overlay-new-game').click();
  for (const p of [A, B]) {
    await p.page.waitForFunction(() => document.querySelectorAll('[data-testid="move-item"]').length === 0, null, { timeout: 10000 });
  }
  check('new game clears the move list for BOTH players', true);
  await A.page.getByTestId('ready-button').waitFor({ timeout: 8000 });
  check('players who have seen the guide get the short "Ready?" card', !(await A.page.getByTestId('guide').isVisible()));
  await shot(A.page, 'ready-card');
  await A.page.getByTestId('ready-button').click();
  await B.page.getByTestId('ready-button').waitFor({ timeout: 8000 });
  await B.page.getByTestId('ready-button').click();
  await A.page.waitForFunction(() => !document.querySelector('[data-testid="ready-card"]'), null, { timeout: 8000 });
  await A.page.waitForTimeout(1500);
  s = await stateFor(BASE, ROOM, sidA);
  check('players keep their seats and names in the new game', s.names.WHITE === 'ALICE' && s.names.BLACK === 'BOBBY', JSON.stringify(s.names));
  check('new game is ongoing with fresh history', s.status === 'ONGOING' && s.history.length === 0);
  check('no name prompt reappears after a new game', !(await A.page.getByTestId('name-input').isVisible()));
  await moveTo(A, [8, 5], [8, 7]);
  await waitForMoves(B.page, 1);
  check('the new game is playable', (await moveList(B.page))[0] === 'i8');

  // A few more moves for the README screenshot
  await B.page.waitForTimeout(300);
  await clickCell(B, 4, 12);
  await waitForMoves(A.page, 2);
  await moveTo(A, [10, 4], [9, 6]);
  await waitForMoves(B.page, 3);
  await B.page.waitForTimeout(300);
  await moveTo(B, [11, 10], [11, 8]);
  await waitForMoves(A.page, 4);
  await A.page.waitForTimeout(300);
  await clickCell(A, 12, 5);
  await waitForMoves(A.page, 5);
  await A.page.waitForTimeout(800);
  await shot(A.page, 'readme-screenshot');

  // ---------- Guide on demand ----------
  await A.page.getByTestId('cmd-help').click();
  await A.page.getByTestId('guide').waitFor({ timeout: 5000 });
  check('"How to play" reopens the guide during a game', true);
  await A.page.keyboard.press('Escape');
  await A.page.waitForTimeout(300);
  check('Escape closes the guide again', !(await A.page.getByTestId('guide').isVisible()));

  // ---------- Draw offer (Black to move, 5 half-moves played) ----------
  await A.page.getByTestId('cmd-offer-draw').click(); // White offers while it is Black's turn
  await B.page.getByTestId('draw-accept').waitFor({ timeout: 8000 });
  check('the opponent sees the draw offer with Accept / Decline', await B.page.getByTestId('draw-decline').isVisible());
  check('the offerer sees that the offer is pending', (await A.page.getByTestId('cmd-offer-draw').textContent()).includes('Draw offered'));
  await C.page.getByTestId('draw-offer-banner').waitFor({ timeout: 8000 });
  check('the spectator sees the offer but cannot answer', (await C.page.getByTestId('draw-accept').count()) === 0);
  const tagBottom = await B.page.evaluate(() => document.querySelector('[data-testid="player-tag-bottom"]').getBoundingClientRect().bottom <= window.innerHeight);
  check('the draw banner does not push the player tags off screen', tagBottom);
  await shot(B.page, 'draw-offer');

  await B.page.getByTestId('draw-decline').click();
  await A.page.waitForFunction(() => !document.querySelector('[data-testid="draw-offer-banner"]'), null, { timeout: 8000 });
  check('declining removes the offer for both players', true);
  check('the same player cannot offer again before making a move', await A.page.getByTestId('cmd-offer-draw').isDisabled());

  await B.page.getByTestId('cmd-offer-draw').click(); // now Black offers
  await A.page.getByTestId('draw-accept').waitFor({ timeout: 8000 });
  await A.page.getByTestId('draw-accept').click();
  await B.page.getByTestId('game-over').waitFor({ timeout: 8000 });
  check('an accepted offer ends the game as a draw for both players', await B.page.getByText('Game drawn by agreement').isVisible() && await A.page.getByTestId('game-over').isVisible());
  s = await stateFor(BASE, ROOM, sidA);
  check('server state: DRAW by AGREEMENT', s.status === 'DRAW' && s.endReason === 'AGREEMENT', `${s.status} ${s.endReason}`);
  await shot(A.page, 'draw-agreed');

  // Start a fresh game so the layout suite watches a live game
  await A.page.getByTestId('overlay-new-game').click();
  await A.page.waitForTimeout(1500);

  return { A, B, C };
}
