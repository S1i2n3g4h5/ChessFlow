# ChessFlow: Rules and Design Specification (v3.0)

This document is the **authoritative description of ChessFlow as implemented** in this repository, version 3.0 (2026-10-24). It replaces the earlier draft spec "Expandable Chess — 16×16 Option 1 (v0.3)". The differences from that draft are listed in [§12](#12-changes-from-the-v03-draft-spec).

Every rule below is enforced by the pure rules engine in `src/game/` and covered by the Vitest suite in `src/game/__tests__/`. Where a section names a test file, that file checks the rule.

---

## Contents

1. [Concept and design goals](#1-concept-and-design-goals)
2. [Board geometry](#2-board-geometry)
3. [Pieces and movement](#3-pieces-and-movement)
4. [Turn structure](#4-turn-structure)
5. [Expansion](#5-expansion)
6. [Promotion](#6-promotion)
7. [Check, end of game and results](#7-check-end-of-game-and-results)
8. [Clock](#8-clock)
9. [Multiplayer model](#9-multiplayer-model) (and [9.5 Computer opponent](#95-computer-opponent))
10. [Architecture](#10-architecture)
11. [Testing](#11-testing)
12. [Changes from the v0.3 draft spec](#12-changes-from-the-v03-draft-spec)
13. [Bugs fixed in v1.7](#13-bugs-fixed-in-v17)
14. [Known limitations and future work](#14-known-limitations-and-future-work)

---

## 1. Concept and design goals

ChessFlow is a deterministic, perfect-information, two-player strategy game. It uses the **standard chess army and movement rules** on a **board whose shape changes during the game**.

**Goals**
- **Familiar start:** the opening position is ordinary chess, so chess intuition carries over.
- **Space as a resource:** a player may spend a whole turn growing the board. That tempo can open a file for a rook, a diagonal for a bishop, an escape square or a new attack lane, or push back the opponent's promotion line.
- **Fewer memorised openings:** expansion changes the geometry, so opening theory goes out of date quickly.
- **Short to explain:** the full rule set fits in a 5–10 minute explanation (rules at a glance in the [README](README.md)).
- **Easy to compute:** the whole game state is plain JSON, and every rule is a pure function, so the server and the browser run exactly the same code.

**Non-goals**
- No piece drops (unlike Crazyhouse). Expansion only adds empty cells.
- No randomness and no hidden information.
- No multi-action turns. A turn is exactly one action.

---

## 2. Board geometry

### 2.1 Grid and coordinates
- The game takes place on a fixed **16×16 grid**. Internally a cell is `(file, rank)` with `file, rank ∈ 0..15` and the id `"file,rank"`.
- File 0 is White's left, and rank 0 is the row nearest White.
- **Human-readable labels** (move list and board edges): files **`a`–`p`**, ranks **`1`–`16`**. For example `(0,0)` is `a1` and `(15,15)` is `p16`.

### 2.2 Active and inactive cells
- Every cell is **active** (part of the board) or **inactive** (a hole that does not exist for play).
- At the start only the **central 8×8** is active: files 4–11 and ranks 4–11, which is **e5–l12** in grid labels.
- Classical square `a1` is grid cell `(4,4)` = `e5`, and classical `h8` is `(11,11)` = `l12`.

### 2.3 Connectivity
- The active cells always form **one orthogonally connected region**.
- This follows from the expansion rule: a new cell must touch an existing active cell orthogonally, and cells are never removed. Test: `expansion.test.ts` fills the whole grid with random expansions and checks connectivity after every step.

### 2.4 Stabilizing cells
A cell activated this turn carries a `stabilizingUntil` marker naming the player who placed it. Its meaning is given in [§5.3](#53-stabilization).

---

## 3. Pieces and movement

### 3.1 Army and starting position
Each side has the standard 16 pieces (K, Q, 2R, 2B, 2N, 8P) in the standard arrangement on the central 8×8: White on classical ranks 1–2 (grid ranks 4–5), Black on classical ranks 7–8 (grid ranks 10–11). White moves first.

### 3.2 Movement
Pieces move and capture exactly as in chess, with these rules for a board with holes:

| Piece | Rule on a dynamic board |
|---|---|
| Rook, Bishop, Queen | Slide along their lines and **stop at the first inactive cell**. A hole blocks the line even if active cells lie beyond it. |
| Knight | Jumps, so inactive cells *between* do not matter. The **landing cell must be active**. |
| King | One step in any direction onto an active cell. |
| Pawn | One step forward onto an empty active cell. Two steps from its starting position if both cells are empty and active. Captures one step diagonally forward. |

- A piece can only use cells it is allowed to enter, and stabilizing cells count for this ([§5.3](#53-stabilization)).
- **Castling** is allowed under the normal chess conditions:
  - neither the king nor that rook has moved;
  - the cells between them are empty;
  - the king is not in check;
  - the king does not pass over or land on an attacked cell.

  Kingside: king two cells toward the h-rook, rook to the cell the king crossed. Queenside: the mirror image with the a-rook.
- **En passant is not part of the game.**
- Tests: `movement.test.ts`, `check.test.ts` (castling block).

---

## 4. Turn structure

On each turn the player to move performs **exactly one** of:

1. **Move:** one legal chess move ([§3](#3-pieces-and-movement)), or
2. **Expand:** activate one legal cell ([§5](#5-expansion)).

Then the turn passes to the opponent. Resignation is also possible at any time ([§7.4](#74-resignation)) and does not depend on whose turn it is.

> **Why move *or* expand?** An earlier design allowed a move *plus* an optional expansion. In playtesting that produced combinations within a single turn that were hard to read. Forcing a choice makes expansion cost a tempo, which is the central trade-off of the game.

---

## 5. Expansion

### 5.1 Which cells can be activated
A cell is a **legal expansion target** for the player to move when **all** of these hold:

1. it is **inactive** and inside the 16×16 grid;
2. it is **orthogonally adjacent** (shares a side) to at least one active cell. Touching only at a corner is not enough;
3. it is **not orthogonally adjacent to either king** (*king buffer*);
4. the player to move is **not in check**;
5. the game is still in progress.

At the start of the game there are **30** legal targets: the 32 frontier cells around the 8×8, minus the cell below White's king and the cell above Black's king.

### 5.2 Effect
- The cell becomes active and stays **empty**. Nothing is dropped onto it.
- `lastExpansion` is set for the board highlight, and the move list records `Exp <cell>`, for example `Exp d8`.
- The turn passes to the opponent.

### 5.3 Stabilization
The new cell is marked as **stabilizing for the player who placed it** and is shown in orange. The marker is cleared when **that player's next turn begins**, which is exactly one opponent turn later.

While the cell is stabilizing:
- **The opponent may not use it at all.** Their pieces cannot move onto it or slide through it, and they cannot use it to block or capture.
- **The placer's pieces may already count it as part of the board.** In practice this matters only for attacks. If the new cell completes a line from the placer's rook to the enemy king, that king is **in check now** and must respond. That response cannot involve the stabilizing cell.

The asymmetry is deliberate. The placer cannot move on the opponent's turn, and by the placer's next turn the cell is a normal cell. So the cell really can be used by the placer on their next turn, and an attack through it is a real threat. Treating it as a threat keeps check detection honest: a player can never make a move that lets their king be captured next turn.

Engine rule (`isCellUsableBy` in `utils.ts`): a color may use a cell when it is active **and** either not stabilizing, or stabilizing for that same color.

Tests: `expansion.test.ts`, including the "discovered check through a new cell" scenario.

### 5.4 Why each constraint exists
| Constraint | Without it |
|---|---|
| Only cells touching the edge | Holes and tunnels appear inside the board, and positions become unreadable |
| Cell stays empty | It becomes a piece-drop game, with far more choices per turn and cheap attacks on the king |
| Stabilization | A player could open a lane and use it before the opponent can react |
| King buffer | A king could be boxed in by geometry alone, with one expansion completing a cage, instead of by coordinated pieces |
| No expansion in check | A player could ignore a check, and their king would simply be captured next turn |
| 16×16 limit | The board could grow without bound; the grid also keeps the state a fixed size (256 cells) |

---

## 6. Promotion

- A pawn promotes when it lands on the **farthest active cell of the column it lands in**, measured from its owner's side. For White that is the highest active rank in that file, and for Black the lowest.
- The player chooses a **Queen, Rook, Bishop or Knight**. A move onto the promotion cell without a choice is rejected.
- Because the line depends on the column, **expanding beyond the end of a column pushes that column's promotion line back**. This is a deliberate defensive use of expansion. Each push costs the defender a tempo, and it can only be repeated up to the edge of the grid.
- The **destination** column decides, not the column the pawn started from. This matters for diagonal captures into a column of a different length.
- Tests: `promotion.test.ts`.

---

## 7. Check, end of game and results

### 7.1 Check
A king is in check when an enemy piece attacks its cell. Attacks follow the movement rules in [§3](#3-pieces-and-movement) and the stabilization rule in [§5.3](#53-stabilization). Pawns attack only diagonally forward.

- A move is legal only if it does **not leave the mover's own king in check**. This covers pins, answering a check, and never walking into an attack.
- **Expansions are not allowed while in check** ([§5.1](#51-which-cells-can-be-activated)), so a check is always answered with a move.
- The UI highlights a king in check in red.

### 7.2 Checkmate
The player to move is **in check and has no legal move**. The opponent wins (`endReason: CHECKMATE`). Expansion cannot help, because it is not allowed in check.

### 7.3 Stalemate and the "must expand" rule
If the player to move is **not in check and has no legal move**:
- if **at least one legal expansion exists**, the game continues and the player **must expand**;
- if **no legal expansion exists either**, the game is a **draw by stalemate** (`endReason: STALEMATE`).

This follows directly from "a turn is a move or an expansion". A player is stalemated only when no action of either kind is available.

### 7.4 Resignation
Either player may resign at any time with **Resign**, which needs a second confirming click. The opponent wins (`endReason: RESIGNATION`).

### 7.5 Timeout
A player whose clock reaches 0:00 loses (`endReason: TIMEOUT`), see [§8](#8-clock).

### 7.6 Draw by agreement
- Either player may press **Offer Draw** at any time during the game, on either player's turn.
- The opponent sees **Accept ½–½ / Decline**. Accepting ends the game as a draw (`endReason: AGREEMENT`); declining removes the offer.
- **Playing on declines.** If the opponent makes a move or an expansion instead of answering, the offer is withdrawn. The offerer's own move does not withdraw it.
- **One offer at a time, one offer per full move:** after offering, a player can offer again only once two more half-moves have been played (stored in `drawOfferPly`).
- Offers never appear in the move history. They are also checked on the server: you can only offer or answer for your own color.

### 7.7 Not part of the rules
Threefold repetition and the 50-move rule are intentionally **not** used. The half-move counter (`halfMoveClock`, reset on any capture or pawn move) is still maintained.

Tests: `check.test.ts` (fool's mate, "must expand", full-grid stalemate), `reducer.test.ts` (resignation), `draw.test.ts` (draw by agreement).

---

## 8. Clock

- **30 minutes per player**, no increment.
- The **server** keeps the authoritative clock (`tickClock` in `src/game/clock.ts`). Browsers count down locally between polls for a smooth display, and the next poll corrects any drift.
- The clock **runs only when**:
  - both seats are filled,
  - both players have entered a name,
  - both players have clicked **I'm ready** (`GameState.ready`, see [§9.6](#96-how-to-play-guide-and-the-ready-step)), and
  - neither seated player has been silent (no poll) for more than 10 seconds.

  Otherwise it is paused, and the paused time is never charged later.
- Elapsed time is charged in whole seconds. The sub-second remainder carries over instead of being dropped, so frequent polling does not distort the clocks.
- Tests: `clock.test.ts`.

---

## 9. Multiplayer model

### 9.1 Rooms, seats and names
- **Rooms:** two fixed rooms, `ALPHA` and `BETA` (*Arena Alpha* and *Arena Beta*). Their names and passcodes live only on the server (`src/server/config.ts`). The defaults are `ARCHON` and `PHANTOM`, overridable with the environment variables `CHESSFLOW_PASSCODE_ALPHA` and `CHESSFLOW_PASSCODE_BETA`. The browser only ever receives the room names.
- **Joining:** the room screen sends the passcode to the server, which checks it (not case-sensitive). A browser that has joined once is a **member** of the room and can rejoin without the passcode, for example after a reload. A `/?room=ALPHA` link only preselects the room; a new visitor still has to enter the code.
- **Sessions:** each browser has a random anonymous id (`crypto.randomUUID()`, kept in `localStorage`). It identifies your seat. There are no accounts.
- **Seats:** in each room the first member is **White**, the second **Black**, and everyone else a **spectator**. That makes 4 players across the two rooms, plus any number of spectators.
- **Names:** each player enters a callsign once. It is stored in the browser and kept by the server across new games in the same room.

### 9.2 The server is the authority
Every request carries the session id, and the server decides what that session may do:

| Who | May | May not |
|---|---|---|
| Non-member | join with the right passcode | read the game, act |
| Spectator | watch the game | any action, start a new game |
| Seated player | move or expand **on their own turn**; resign, rename, offer or answer a draw **for themselves**; start a new game once the game is over | move on the opponent's turn; act for the other color (a forged `player` field is replaced by the sender's own color); force a new game mid-game |

- Moves, expansions and draw offers are refused until both seats are filled, both players have a name, and both are ready.
- Every action is then re-checked by the same `gameReducer` that the browsers use. An illegal move is refused (HTTP 422) and changes nothing.
- There is no way to upload a game state. Older versions accepted a whole replacement state from any client; that request was removed in v1.8.

### 9.3 Sync
- Every client polls `GET /api/game?roomId&sessionId` once per second and receives `{ state, role, playerCount }` in one response.
- A player's own action is applied immediately in their browser (optimistic update) and sent with `POST`. The server's reply replaces it, and if the server refused the action, the client reloads the server's state.
- Each state has a `version` (incremented on every accepted action, and on a timeout) and a `gameId` (new for every game). A client never steps back to an older version of the same game, and always accepts a different `gameId`, which is how a new game reaches both players.
- **Performance:**
  - the board re-renders only when the game itself changes;
  - clock values are synced separately and only update the two clock displays;
  - the board component is memoised.

### 9.4 Room lifecycle
- **New game:** after a game ends, either player can start a new one. The board resets, and the players keep their seats, colors and names.
- **Everyone left:** if every seated player has been silent (no poll) for 15 seconds, the room resets. Spectators who are still watching take the free seats in the order they joined.
- **3-hour rule:** a room with **no activity for 3 hours** is closed.
  - Activity means a join, an accepted action or a new game. Polling does not count, so a forgotten open tab cannot keep a room locked forever.
  - The board is reset and every member is removed.
  - Anyone still on the page is sent back to the room screen with "This room was closed after 3 hours of inactivity", and can join again with the passcode.
  - Rooms are checked on every request and once a minute. The limit can be changed with `CHESSFLOW_ROOM_IDLE_MS` (the browser tests use 6 seconds).
- **Storage:** rooms live **in the memory of the Node.js process**. There is no database by design, so the app must run as a single Node.js instance. See the deployment section of the README.

### 9.5 Computer opponent
**Where it runs.** Entirely in the browser: no server requests, no account. The search runs in a **Web Worker** (`src/game/ai/ai.worker.ts`), so the page stays responsive while the computer thinks. If workers are unavailable, it falls back to the main thread. The game, its settings and its clocks are saved in `localStorage`, so a reload offers **Resume**. A game with no move for **3 hours** is closed, as with online rooms.

**Fast engine, proven equal to the rules.** The rules engine (`engine.ts`) copies the whole game for every candidate move. That is clear and safe, but too slow for a search. `ai/position.ts` keeps a mirror of the same rules:
- the board in typed arrays (`sq = rank × 16 + file`; pieces as signed codes);
- per-file promotion bounds;
- stabilizing owners;
- incremental **Zobrist hashing**;
- **make/unmake** instead of copying.

`ai/__tests__/equivalence.test.ts` checks that, on every position of 8 random games plus edge cases (castling through attack, promotion lines, full grid, discovered check through a new cell), the fast engine produces exactly the same set of legal actions and the same check verdict as `engine.ts`.

**Search** (`ai/search.ts`):
- iterative-deepening negamax with alpha-beta;
- a quiescence search on captures and promotions (all evasions when in check);
- check extensions;
- a transposition table of 2¹⁸ entries;
- move ordering: stored best move, then captures (most valuable victim first), promotions, killer moves, history heuristic.

Expansions multiply the branching factor (often 30 or more legal expansions), so each node searches only the **K most promising** ones, ranked by a cheap heuristic:
- the new cell completes a line for one of the bot's sliders;
- it pushes back an enemy pawn's promotion line;
- it sits next to the bot's own pieces.

When a player has no legal move but can expand, **all** expansions are searched, because the rules force one.

**Evaluation** (`ai/evaluate.ts`, in centipawns):
- material (P 100, N 320, B 330, R 500, Q 900);
- **mobility on the current board**, so lines opened by expansions are valued automatically;
- pawn progress measured against *its own column's* promotion line;
- centralisation relative to the centre of the *active* board;
- king shield and escape squares;
- enemy pieces near the king;
- a small tempo bonus.

**Levels** (`ai/bot.ts`):

| Level | Search | Expansions considered (root / inner) | Character |
|---|---|---|---|
| Easy | depth 2, ≤ 0.4 s, exact root scores | 6 / 2 | picks randomly among moves within 1.2 pawns of the best |
| Medium | iterative deepening to depth 5, ≤ 1 s | 8 / 3 | best move found |
| Hard | iterative deepening to depth 12, ≤ 2.8 s | 12 / 4 | best move found |

Measured speed is about **240,000 positions per second** in Node. From the opening, Medium reaches depth 5 in about 0.2 s.

**Draw offers:** the computer runs a short search and accepts only if it is at least 2 pawns worse, or the position is dead level after 80 or more half-moves. Making a move counts as declining.

**Undo:** takes back your last move and the computer's reply, by rebuilding the position from the history (`reconstructState`). Not available while the computer is thinking, or after a resignation, timeout or agreed draw.

**Clocks:** in timed games, each side's thinking time comes off its own clock, the computer's included. A move is never shown sooner than 0.45 s after your move, so replies don't feel instant and robotic.

### 9.6 How-to-Play guide and the Ready step
- **Guide** (`src/game/guide.ts`, `src/components/HowToPlayGuide.tsx`): 8 steps. Each has a short text and a **mini board**, which is an ordinary `GameState` rendered with the normal board component and played through the real `gameReducer`. A step can have a goal (for example "an expansion was made"); when it is reached, the step shows a success message. Steps: goal of the game, move, expand, stabilizing cells, king buffer and check, holes and knights, moving promotion line, then clock, draws and notation. Navigation: Back/Next, progress dots, arrow keys, *Skip*, *Try again*.
- **When it appears:** before the first game in a browser (remembered in `localStorage`), for both online players as soon as both are seated and named, and before the first computer game. After that, a short **Ready?** card replaces it. It can always be reopened: *How to Play* in the menu, or *How to play* in the game, where Escape closes it and a note says the clock keeps running.
- **Ready step:** the `READY` action sets `ready[color]`. A new game resets it. The clock, and the server's acceptance of moves, wait for both players. The first player who is ready sees "Waiting for … to get ready", and spectators see "Waiting for both players to get ready". In computer games the bot is always ready.
- Tests: `guide.test.ts` proves every step is a legal position whose goal can be reached with a legal action.

---

## 10. Architecture

### 10.1 Layers
```
Browser (React: src/app/page.tsx, src/components, src/hooks)
   │  GameScreen renders a GameController, which comes from either
   │  useOnlineGame (polls once a second, applies own actions optimistically, POSTs them) or
   │  useComputerGame (local reducer + bot in a Web Worker, src/game/ai; never talks to the server)
   ▼
Next.js route handler (src/app/api/game/route.ts), a thin HTTP layer
   ▼
RoomStore (src/server/roomStore.ts), server-only
   │  passcodes, members and seats, who may act, clock ticking, 3-hour rule
   ▼
Rules engine (src/game/*.ts), pure TypeScript, shared by browser and server
   types · utils · engine · reducer · notation · clock · playback
```
The rules engine never imports React or performs network calls, which is why it can be unit-tested in isolation and run unchanged on both sides.

### 10.2 State model (`src/game/types.ts`)
| Field | Meaning |
|---|---|
| `gameId` | Random id of this game; changes on every new game |
| `board` | 256 cells: `{ id, file, rank, active, stabilizingUntil }` |
| `pieces` | `{ id, owner, type, cellId, hasMoved }` keyed by id |
| `currentPlayer` | `WHITE` / `BLACK` |
| `status`, `endReason` | `ONGOING` / `WHITE_WIN` / `BLACK_WIN` / `DRAW`; `CHECKMATE` / `STALEMATE` / `RESIGNATION` / `TIMEOUT` / `AGREEMENT` |
| `drawOffer`, `drawOfferPly` | Color with a pending draw offer (or none); history length at each side's last offer |
| `names` | Callsign per color |
| `history`, `notation` | Accepted moves and expansions only, with their notation (`notation[i]` describes `history[i]`) |
| `lastMove`, `lastExpansion` | For board highlights |
| `halfMoveClock` | Half-moves since the last capture or pawn move |
| `version` | Incremented on every accepted action |
| `clocks`, `lastTick` | Seconds left per color; server time reference |

### 10.3 Actions and the reducer
`gameReducer(state, action)` is the only way the game changes. Actions:

| Action | Payload | Notes |
|---|---|---|
| `MOVE` | `pieceId, toCellId, promotionTo?, isCastling?` | Must exactly match a legal move from `getLegalMoves` |
| `EXPAND` | `cellId` | Must be in `getLegalExpansionTargets` |
| `SET_NAME` | `player, name` | Trimmed, max 16 characters; not part of the move history |
| `READY` | `player` | Marks that player as ready (once per game) |
| `RESIGN` | `player` | Ends the game for the opponent |
| `OFFER_DRAW` | `player` | Allowed by `canOfferDraw` (`src/game/draw.ts`): game ongoing, nothing pending, one offer per full move |
| `RESPOND_DRAW` | `player, accept` | Only the opponent of the offerer; `accept: true` ends the game as `DRAW` / `AGREEMENT` |

**Contract:** an invalid action returns **the same state object**: nothing changes, nothing is logged and the version is not bumped. A valid action returns a **new** object (the input is never mutated) with `version + 1`. After a move or expansion the reducer switches the player, clears that player's stabilizing cells, checks for checkmate or stalemate, and appends the notation.

### 10.4 Key engine functions (`src/game/engine.ts`)
| Function | Purpose |
|---|---|
| `getPseudoLegalMoves` | Piece movement on the dynamic board, including castling and promotion variants |
| `getLegalMoves` | Removes moves that leave the own king in check; castling safety |
| `isSquareAttacked` / `isInCheck` | Direct attack test (pawns diagonal only; sliders need a clear, usable path) |
| `getLegalExpansionTargets` | Boundary + king buffer + not-in-check |
| `applyMove` | Applies capture, promotion and the castling rook (shared by validation and the reducer) |
| `getFarthestRankInColumn` / `isPromotionMove` | Promotion line per column |

### 10.5 HTTP API (`/api/game`)
| Request | Effect |
|---|---|
| `GET /api/game` | `{ rooms: [{ id, name }] }`, with no passcodes |
| `GET /api/game?roomId=R&sessionId=S` | `{ state, role, playerCount }` for a member (marks S as present, ticks the clock) |
| `POST { op: 'join', roomId, sessionId, passcode? }` | Becomes a member if the passcode is right (not needed to rejoin) and claims a free seat |
| `POST { op: 'action', roomId, sessionId, action }` | Applies a `TurnAction` if this session may perform it ([§9.2](#92-the-server-is-the-authority)) |
| `POST { op: 'reset', roomId, sessionId }` | New game, same seats and names; seated players only, not while a game is in progress |

Errors come back as `{ error: CODE }` with an HTTP status:

| Status | Codes |
|---|---|
| 400 | `INVALID_REQUEST` |
| 401 | `PASSCODE_REQUIRED`, `NOT_JOINED` |
| 403 | `WRONG_PASSCODE`, `SPECTATOR`, `NOT_YOUR_TURN` |
| 404 | `UNKNOWN_ROOM` |
| 409 | `GAME_NOT_STARTED`, `GAME_IN_PROGRESS` |
| 410 | `ROOM_EXPIRED` |
| 422 | `ILLEGAL_ACTION` |

### 10.6 UI notes
- **Design system:** the tokens live in `src/app/globals.css`:
  - surfaces `canvas`, `surface`, `raised`;
  - lines `line`, `line-strong`;
  - text `ink`, `muted`;
  - one `accent` (cyan) with `on-accent`;
  - `danger`, `warn` and `success`, used only for meaning.

  Fonts are Chakra Petch for display and Inter for text. Shared button, panel and dialog classes are in `src/components/ui.ts`.
- The board palette is steel blue (`#dbe4f0` / `#6c86ab`) on a navy void. Highlights: cyan for the last move, your selection and cells you can add; amber for settling cells; red for check. Those overlay elements carry `data-kind` attributes (`expansion-target`, `stabilizing`, `check`) for the browser tests.
- `BoardSVG` draws the 16×16 grid as an SVG with layers: cells, last move and last expansion, legal-move dots, expansion targets, stabilizing cells, check warning, coordinates, then pieces. The board is rotated 180° for Black.
- **Free view** shows the whole grid and allows pan and zoom. **Locked view** sets the SVG `viewBox` to a square that frames every active cell plus two cells of padding, computed after rotating for the viewer's side (`computeViewBox`).
- The move list pairs `notation` entries as White/Black. Clicking an entry, or using the ⏮ ◀ ▶ ⏭ controls, rebuilds that position from `history` (`reconstructState`, where index −1 is the starting position).

---

## 11. Testing

Run `npm test` to execute **163 Vitest tests in 15 files** against the rules engine and the room store:

| Suite | What it proves |
|---|---|
| `setup` | Correct starting grid and army; 20 opening moves (as in chess); 30 opening expansion targets |
| `movement` | Pawns (single, double, captures, holes), sliders stopping at holes, expanded cells extending lines, knights jumping the void |
| `check` | Pins; only check-resolving moves; king cannot walk into attack; pawn attacks are diagonal; no expansion in check; regression for the king-capture bug; castling (both sides, moved king or rook, blocked, in check, through or onto attacked cells); fool's mate; "must expand"; full-grid stalemate |
| `expansion` | Boundary rule, king buffer for both kings anywhere, turn bookkeeping, stabilization blocking the opponent and clearing on time, placer's own use, discovered check through a new cell, connectivity until the grid is full |
| `promotion` | Four choices, a choice required, black promotion, expansion pushing the line back, destination-column rule in both directions |
| `reducer` | Rejected actions return the same object; no mutation; turn alternation; highlights; half-move counter; names; resignation; replay of every position |
| `notation` | Grid labels, pawn and piece moves, captures, check, file and rank disambiguation |
| `clock` | Anchoring, whole-second charging, carrying the remainder, pausing, timeout, finished games |
| `viewbox` | Free view; locked view for both colors; regression for Black's view of a board expanded to the right edge; 120 random expansions always fully framed |
| `invariants` | Six seeded random games (up to 80 turns): kings never captured, the mover never left in check, pieces only on active cells, board connected, history and notation in step, replay identical |
| `draw` | Offer and accept, decline, offering on the opponent's turn, only the opponent can answer, playing on (move or expansion) declines, one offer at a time and per full move, nothing after the game ends, history untouched |
| `guide` | Every guide step: legal position, White to move, goal reachable with a legal action; orange cell blocked; no expansions in the check step; promotion on the longer column; scenarios are fresh copies |
| `ai/equivalence` | Fast engine and rules engine produce identical legal actions and check verdicts on 8 random games and edge cases; make/unmake restores everything; incremental hash equals a fresh hash |
| `ai/bot` | Legal opening at every level; mate in one; captures a hanging queen; doesn't hang its queen; answers check; expands when forced; every bot action across random games accepted by the reducer; time limit; draw judgement; speed benchmark |
| `server/roomStore` | Passcodes (right, wrong, missing, other room's code), seat order, rejoin without a code, separate rooms, members-only reading, turn checks, spectators and strangers refused, forged `player` fields (also for draw offers and answers), malformed and smuggled actions, no moves before both are named, new-game rules, the 3-hour rule (polling isn't activity, a move restarts the countdown, lobby rooms, rejoining afterwards, custom limit), clock pause on disconnect, all-gone reset |

`npm run test:e2e` builds the app and drives **real browser windows** (the installed Microsoft Edge or Google Chrome, via `playwright-core`) through the production server. As of v3.0 it runs **132 checks**, all passing:
- **security:** hand-crafted requests (passcodes absent from the page and all its JavaScript, refused joins, out-of-turn moves, spectators, strangers, forged player fields, the removed state upload, illegal moves);
- **online:** two players and a spectator through the passcode screen, lobby, direct link, names, reload rejoin, the guide (both players, playable mini board, keyboard, waiting card, clock and server waiting for both, short *Ready?* card for a new game, reopen and Escape), moves, expansion and stabilization, check, playback, Black's locked view, resign, result screen and new game, and the draw offer (banner, spectator view, decline, one-offer limit, accept); your own move shows in under 100 ms (measured: 17 ms);
- **layout:** 1920×1080, 1440×900, 1366×768 and 390×844;
- **computer:** Easy as White and Medium as Black with a 10-minute clock: setup, thinking indicator, replies within time, no main-thread task over 100 ms while the bot thinks, no server requests, undo, draw declined, reload and resume, resign, new game, clocks charged correctly, 3-hour rule, phone layout;
- **expiry:** a second server with a 10-second limit keeps the room open while it is being polled, then closes it, tells the player why, and allows rejoining.

No browser console errors are allowed.

---

### 11.1 Balance experiments
`npm run simulate` plays the game's own bot against itself (Medium search, a fixed 6,000 nodes per move, 4 random opening half-moves, a cap of 200 half-moves, adjudication at ±3 pawns). It writes [docs/balance-report.md](docs/balance-report.md).

| Question | Result (v2.1, 500 games) |
|---|---|
| Is the game fair between colors? | Yes: White scored 49.8 % (95 % CI 45.2–54.5 %) over 300 self-play games |
| Is expansion used? | In 89 % of games; about 25 cells per game, almost none in the first 20 half-moves; the board grows from 64 to about 97 cells by half-move 200 |
| Does expanding win games by itself? | No: an expansion-aware bot scored 44.8 % (CI 39.0–50.5 %) against an identical bot that never expands. Expansion costs a move and must be timed well, which is the intended strategic trade-off; it also shows the bot's expansion heuristic is the main thing to improve |

## 12. Changes from the v0.3 draft spec

| Topic | v0.3 draft | v1.7 (implemented) |
|---|---|---|
| Turn | Mandatory move + optional expansion | Move **or** expansion |
| Winning | Capture the king; no check | Standard check and checkmate |
| Expansion budget | Tokens earned by captures, max 16 per player | No tokens and no budget; limited only by the grid |
| Castling | Not allowed | Allowed (standard conditions) |
| En passant | Not allowed | Not allowed |
| Promotion | Farthest active rank | Farthest active cell of the **destination column** |
| Stalemate | n/a | Draw only if no move **and** no expansion is available |
| Expansion in check | n/a | Not allowed |
| Draw by repetition / no progress | Specified | Intentionally not used |
| Draw by agreement | Specified | Draw offer button, one offer per full move |
| Transport | WebSockets | HTTP polling (1 s) against a Next.js route handler |

---

## 13. Bugs fixed in v1.7

| # | Problem in v1.6 | Fix |
|---|---|---|
| 1 | A player in check could expand instead of answering; the opponent then captured the king and the game went on with no king | Expansions are illegal while in check |
| 2 | Stabilizing cells were only drawn in orange; the opponent could move onto them immediately | Opponent cannot use them until the placer's next turn; attacks through them count for the placer |
| 3 | King buffer from the spec was missing | Cells orthogonally adjacent to either king cannot be activated |
| 4 | Rejected actions were still appended to the history and bumped the version | Invalid actions return the unchanged state |
| 5 | Move list showed raw piece ids ("W_pawn_4"); name changes were logged as moves, shifting White/Black columns | Real notation; only moves and expansions are logged |
| 6 | Promotion used the pawn's starting column, wrong for captures into a column of different length | Destination column decides |
| 7 | "No legal move" was treated as stalemate even when an expansion was available | Stalemate requires no move and no expansion |
| 8 | Castling ignored pawns attacking the cell the king passes (pawn forward moves were counted as attacks instead) | Dedicated attack test: pawns attack diagonally only |
| 9 | Abandon Protocol wiped the room for both players without a result | It is now resignation, with confirmation; the result screen gives the reason |
| 10 | "Initiate New Protocol" only reloaded the page, and after a reset the other player's client kept ignoring the server (older version number) | New game resets the room; clients detect a new `gameId` |
| 11 | Locked view was computed without accounting for the rotated board, so Black could lose the edge of an expanded board | View box computed after rotating for the viewer, as a square |
| 12 | On desktop the zoom container was larger than the board frame, cutting off the board edges; on 1366×768 laptops the top of the board column was cut off with no way to scroll to it | Container fills the frame exactly; board column sized to the screen height with safe centring |
| 13 | White's clock ran while waiting in the lobby; fractions of seconds were lost on every poll | Clock runs only once both players are seated and named; the remainder carries over |
| 14 | "Previous move" from live jumped to move 1; the starting position could not be viewed | Step-by-step playback, starting position included |
| 15 | Spectators were exempt from the client-side turn check | Spectators cannot send actions from the UI |
| 16 | Browser tab title "Create Next App"; lint error in `utils.ts`; unused code | ChessFlow title and description; ESLint clean |

---

## 14. Known limitations and future work

The list of pending items is kept in the README, under [Pending resolutions and future changes](README.md#pending-resolutions-and-future-changes). In short:
- no repetition or 50-move draws (left out on purpose);
- in-memory, single-instance storage (no database by design);
- seats are tied to an anonymous id in browser storage.

Ideas for later: smarter computer expansions, game-record export, on-demand rooms and push-based sync.
