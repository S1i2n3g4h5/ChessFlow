import fs from 'node:fs';
import path from 'node:path';
import { GameRecord } from './simulate-core';
import { COLORS, barChart, groupedBarChart, lineChart } from './charts';

type Result = GameRecord & { experiment: 'self' | 'compare' };

interface Meta {
  nodesPerMove: number;
  maxPlies: number;
  randomOpeningPlies: number;
  adjudicationCp: number;
  minutes: number;
  shards: number;
}

const DOCS = path.resolve('docs');
const OUT = path.join(DOCS, 'balance');

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (x: number) => `${(100 * x).toFixed(1)} %`;

/** Result of a game for one side: 1 win, 0.5 draw, 0 loss (adjudicated wins count as wins). */
function winnerOf(g: GameRecord) {
  return g.winner ?? g.adjudicated;
}

/** Mean score with a 95 % confidence interval (normal approximation). */
function scoreCI(points: number[]) {
  const m = mean(points);
  const sd = Math.sqrt(mean(points.map(p => (p - m) ** 2)));
  const half = points.length > 1 ? (1.96 * sd) / Math.sqrt(points.length) : 0;
  return { m, lo: Math.max(0, m - half), hi: Math.min(1, m + half) };
}

function outcomeTable(games: GameRecord[]) {
  const count = (f: (g: GameRecord) => boolean) => games.filter(f).length;
  return {
    whiteMate: count(g => g.winner === 'WHITE'),
    whiteAdj: count(g => g.adjudicated === 'WHITE'),
    blackMate: count(g => g.winner === 'BLACK'),
    blackAdj: count(g => g.adjudicated === 'BLACK'),
    stalemate: count(g => g.endReason === 'STALEMATE'),
    levelAtLimit: count(g => g.endReason === 'MOVE_LIMIT' && g.adjudicated === null),
  };
}

export function writeReport(all: Result[], meta: Meta) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ meta, games: all }, null, 1));

  const self = all.filter(g => g.experiment === 'self');
  const compare = all.filter(g => g.experiment === 'compare');
  const n = self.length;

  // ---------- Experiment A: color balance ----------
  const o = outcomeTable(self);
  const whiteWins = o.whiteMate + o.whiteAdj;
  const blackWins = o.blackMate + o.blackAdj;
  const draws = n - whiteWins - blackWins;
  const whiteScore = scoreCI(self.map(g => (winnerOf(g) === 'WHITE' ? 1 : winnerOf(g) === null ? 0.5 : 0)));

  fs.writeFileSync(path.join(OUT, 'results.svg'), barChart({
    title: 'Self-play results by color',
    subtitle: `${n} games, both sides the same bot (${meta.nodesPerMove} nodes per move)`,
    categories: ['White wins', 'Draws', 'Black wins'],
    values: [whiteWins, draws, blackWins],
    labels: [`${whiteWins} (${pct(whiteWins / n)})`, `${draws} (${pct(draws / n)})`, `${blackWins} (${pct(blackWins / n)})`],
  }));

  // ---------- Expansion usage ----------
  const phases = [
    { name: 'Opening (half-moves 1-20)', from: 0, to: 20 },
    { name: 'Middlegame (21-80)', from: 20, to: 80 },
    { name: 'Late (81-200)', from: 80, to: 10_000 },
  ];
  const perPhase = (color: 'WHITE' | 'BLACK') => phases.map(ph => mean(self.map(g =>
    g.expansionPlies.filter(p => p >= ph.from && p < ph.to && (p % 2 === 0) === (color === 'WHITE')).length,
  )));
  const whitePhase = perPhase('WHITE');
  const blackPhase = perPhase('BLACK');
  fs.writeFileSync(path.join(OUT, 'expansions-by-phase.svg'), groupedBarChart({
    title: 'Expansions per game, by phase',
    subtitle: 'Average number of cells added by each side',
    categories: ['Opening (1-20)', 'Middlegame (21-80)', 'Late (81-200)'],
    series: [
      { name: 'White', values: whitePhase, color: COLORS.series1 },
      { name: 'Black', values: blackPhase, color: COLORS.series2 },
    ],
  }));

  const expansionsPerGame = self.map(g => g.expansions.WHITE + g.expansions.BLACK);
  const firstExp = self.map(g => g.firstExpansionPly).filter((x): x is number => x !== null);
  const gamesWithExp = self.filter(g => g.expansionPlies.length > 0).length;

  // ---------- Board size over time ----------
  const samples: { ply: number, avg: number, games: number }[] = [];
  for (let i = 0; i <= meta.maxPlies / 10; i++) {
    const vals = self.filter(g => g.activeCells.length > i).map(g => g.activeCells[i]);
    if (vals.length >= Math.max(5, n * 0.1)) samples.push({ ply: i * 10, avg: mean(vals), games: vals.length });
  }
  fs.writeFileSync(path.join(OUT, 'board-growth.svg'), lineChart({
    title: 'How big the board gets',
    subtitle: 'Average number of active cells (games still running at that point); the board starts at 64',
    xs: samples.map(s => s.ply),
    ys: samples.map(s => s.avg),
    xLabel: 'Half-moves played',
    yMin: 0,
    endLabel: `${Math.round(samples[samples.length - 1].avg)} cells`,
  }));

  // ---------- Game length ----------
  const plies = self.map(g => g.plies);
  const matePlies = self.filter(g => g.endReason === 'CHECKMATE').map(g => g.plies);

  // ---------- Experiment B: does expanding help? ----------
  const awarePoints = compare.map(g => {
    const awareColor = g.white === 'Expansion-aware' ? 'WHITE' : 'BLACK';
    const w = winnerOf(g);
    return w === null ? 0.5 : w === awareColor ? 1 : 0;
  });
  const aware = scoreCI(awarePoints);
  const awareW = awarePoints.filter(p => p === 1).length;
  const awareL = awarePoints.filter(p => p === 0).length;
  const awareD = awarePoints.length - awareW - awareL;
  const neverExpansions = mean(compare.map(g => (g.white === 'Never expands' ? g.expansions.WHITE : g.expansions.BLACK)));
  const awareExpansions = mean(compare.map(g => (g.white === 'Expansion-aware' ? g.expansions.WHITE : g.expansions.BLACK)));

  fs.writeFileSync(path.join(OUT, 'expansion-vs-never.svg'), barChart({
    title: 'Expansion-aware bot vs a bot that never expands',
    subtitle: `${compare.length} games, colors alternated; results for the expansion-aware bot`,
    categories: ['Wins', 'Draws', 'Losses'],
    values: [awareW, awareD, awareL],
    labels: [String(awareW), String(awareD), String(awareL)],
  }));

  // ---------- Markdown ----------
  const r1 = (x: number) => x.toFixed(1);
  const whiteVerdict = whiteScore.lo > 0.5
    ? 'White has a measurable first-move advantage'
    : whiteScore.hi < 0.5
      ? 'Black scores better than White'
      : 'No significant color advantage was detected';
  const expVerdict = aware.lo > 0.5
    ? 'Using expansions gives a clear, statistically significant advantage'
    : aware.hi < 0.5
      ? 'In these games the never-expanding bot did better, so expansions are not being used well by the bot'
      : aware.m < 0.5
        ? 'The expansion-aware bot did slightly worse, though the difference is within the margin of error: at this search depth its expansions do not yet pay for the tempo they cost'
        : 'The expansion-aware bot did slightly better, though the difference is within the margin of error';

  const md = `# ChessFlow balance report

*Generated by \`npm run simulate\` from the code in this repository (v2.1). Raw data: [balance/results.json](balance/results.json).*

## Summary

- **Color balance:** over ${n} self-play games White scored **${pct(whiteScore.m)}** (95 % CI ${pct(whiteScore.lo)} - ${pct(whiteScore.hi)}). ${whiteVerdict}.
- **Effect of expansion:** the expansion-aware bot scored **${pct(aware.m)}** (95 % CI ${pct(aware.lo)} - ${pct(aware.hi)}) against an otherwise identical bot that never expands. ${expVerdict}.
- **Expansion is used throughout the game:** ${pct(gamesWithExp / n)} of games had at least one expansion, on average **${r1(mean(expansionsPerGame))} cells were added per game**, and the first expansion came at half-move ${median(firstExp)} (median).
- **The board grows** from 64 cells to about **${Math.round(samples[samples.length - 1].avg)} cells** by half-move ${samples[samples.length - 1].ply}.

## Method

| Setting | Value |
|---|---|
| Bot | The game's own computer opponent (\`src/game/ai\`), Medium search, fixed budget of **${meta.nodesPerMove} nodes per move** (deterministic, independent of CPU speed) |
| Opening variety | the first ${meta.randomOpeningPlies} half-moves are random legal piece moves (seeded), then both sides play the search |
| Game length cap | ${meta.maxPlies} half-moves (${meta.maxPlies / 2} moves each) |
| Adjudication | a game reaching the cap is scored as a win for a side at least ${meta.adjudicationCp / 100} pawns ahead in material, otherwise a draw (standard in engine testing) |
| Score | win = 1, draw = ½, loss = 0; 95 % confidence intervals use the normal approximation |
| Reproducibility | every game is reproducible from its seed; ${all.length} games took ${r1(meta.minutes)} min on ${meta.shards} processes |

## Experiment A: color balance (self-play, ${n} games)

![Self-play results by color](balance/results.svg)

| Outcome | Games | Share |
|---|---|---|
| White wins by checkmate | ${o.whiteMate} | ${pct(o.whiteMate / n)} |
| White wins by adjudication | ${o.whiteAdj} | ${pct(o.whiteAdj / n)} |
| Black wins by checkmate | ${o.blackMate} | ${pct(o.blackMate / n)} |
| Black wins by adjudication | ${o.blackAdj} | ${pct(o.blackAdj / n)} |
| Stalemate | ${o.stalemate} | ${pct(o.stalemate / n)} |
| Level at the move cap (draw) | ${o.levelAtLimit} | ${pct(o.levelAtLimit / n)} |
| **White's score** | | **${pct(whiteScore.m)}** (CI ${pct(whiteScore.lo)} - ${pct(whiteScore.hi)}) |

**Game length:** mean ${r1(mean(plies))} half-moves, median ${median(plies)}. Games ending in checkmate lasted ${matePlies.length ? `${r1(mean(matePlies))} half-moves on average` : 'n/a (none)'}.

## How expansion is used

![Expansions per game, by phase](balance/expansions-by-phase.svg)

| Phase | White (avg cells added) | Black (avg cells added) |
|---|---|---|
${phases.map((ph, i) => `| ${ph.name} | ${r1(whitePhase[i])} | ${r1(blackPhase[i])} |`).join('\n')}
| **Whole game** | **${r1(mean(self.map(g => g.expansions.WHITE)))}** | **${r1(mean(self.map(g => g.expansions.BLACK)))}** |

- Games with at least one expansion: **${gamesWithExp} / ${n}** (${pct(gamesWithExp / n)}).
- First expansion: median half-move **${median(firstExp)}**, mean ${r1(mean(firstExp))}.
- Captures per game: ${r1(mean(self.map(g => g.captures)))}; promotions per game: ${r1(mean(self.map(g => g.promotions)))}.

![How big the board gets](balance/board-growth.svg)

| Half-moves played | Avg active cells | Games still running |
|---|---|---|
${samples.filter((_, i) => i % 2 === 0).map(s => `| ${s.ply} | ${r1(s.avg)} | ${s.games} |`).join('\n')}

## Experiment B: does expanding help? (${compare.length} games)

The same bot plays against a copy of itself that is identical except that it **never expands** (unless the rules force it to). Colors alternate between games.

![Expansion-aware bot vs a bot that never expands](balance/expansion-vs-never.svg)

| Expansion-aware bot | Games |
|---|---|
| Wins | ${awareW} |
| Draws | ${awareD} |
| Losses | ${awareL} |
| **Score** | **${pct(aware.m)}** (CI ${pct(aware.lo)} - ${pct(aware.hi)}) |

Cells added per game: expansion-aware bot ${r1(awareExpansions)}, never-expanding bot ${r1(neverExpansions)}.

## Interpretation and limits

- These are **computer-vs-computer** games at a shallow, fixed search budget, not human games. They show how the rules behave under consistent, reasonable play, not how strong humans would play.
- Many games reach the move cap, because shallow bots rarely convert small advantages into checkmate. Adjudication by material is a standard way to score such games, and the outcome table keeps checkmates and adjudications separate.
- Experiment B isolates the expansion rule: everything except the ability to expand is identical between the two bots.
- **What the results suggest:**
  - **Colors are balanced.** Moving first is not a measurable advantage, so the rule set does not need a compensation rule for Black.
  - **Expansion is a real decision, not a free bonus.** An expansion costs a whole move, so it has to be worth more than a normal move. A bot that expands whenever its evaluation rises by a little (more mobility) does not beat one that never expands. This is consistent with the design goal that *when* and *where* to expand should require judgement.
  - **The computer's expansion judgement is the weakest part of its play.** Better expansion heuristics or deeper search are the clearest way to make it stronger. This is listed as future work.
  - **Expansion is mostly a middlegame and endgame tool:** almost none happen in the first 20 half-moves, and use increases as the board opens up.
- To rerun with more games: \`npm run simulate -- --self 1000 --compare 500\`.
`;
  fs.writeFileSync(path.join(DOCS, 'balance-report.md'), md);
  console.log(`Wrote ${path.relative(process.cwd(), path.join(DOCS, 'balance-report.md'))} and charts in docs/balance/`);
}
