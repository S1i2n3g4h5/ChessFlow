# ChessFlow Implementation Plan

> **Historical document (April 2026).** It records the decisions made for the first build. The current, authoritative rules are in [PROJECT.md](PROJECT.md). Since this plan, turns became "move **or** expand", and expansion tokens were removed entirely.

## Final Approved Rule Changes & Decisions

1. **Check and Checkmate (instead of King Capture)**
   - **Move Validation**: Players cannot make a move that leaves or places their own King in check.
   - **Win Condition**: The game ends on Checkmate. Stalemate logic will also apply (if a player has no legal moves but is not in check, it's a draw).

2. **Removal of Activation Budget**
   - The 16-cell activation hard limit per player is removed. Players can earn and spend tokens indefinitely (up to the physical 16x16 grid limit), creating a potentially massive playable area over time.

3. **Special Moves**
   - **Castling**: ALLOWED (following normal chess rules, but mapping to our central 8x8 starting area).
   - **En Passant**: EXCLUDED.

4. **Pawn Promotion**
   - A pawn can promote if it reaches the standard 8th rank (as in normal chess) OR if it reaches the deepest active line on the opponent's side of the board at the time of the move. 

5. **Expansion Rule Geometry**
   - As per the spec, you can only expand by selecting an *inactive* cell adjacent to an *active* cell. 
   - A piece cannot "phase" an active tile in between two existing elements because the board starts fully connected and you can only grow by adding to the *outside edges*. Expansion cells do not block existing sightlines inside the active board.

6. **MVP Architecture (Pass-and-Play)**
   - To rapidly test the engine and geometry logic, the first build will be a **local Pass-and-Play app** (two players sharing one screen). 
   - **Stack**: Next.js (React) + Tailwind CSS + Custom Chess Engine.

## Technical Architecture Implications

1. **Custom Move Generation & Engine**: 
   Because of the dynamic 16x16 grid and inactive cells, we will implement from scratch:
   - Piece pathfinding and sliding logic (accounting for inactive/stabilizing cells).
   - Check detection (identifying if the King's square is under attack).
   - Checkmate/Stalemate detection (verifying if any legal move exists).
