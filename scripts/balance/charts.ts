/**
 * Tiny static SVG chart helpers for the balance report (rendered as images in Markdown).
 * Light chart surface so they read the same on light and dark GitHub themes.
 * Palette: reference categorical slots 1-2 (blue, orange), validated with the dataviz validator.
 */

export const COLORS = { series1: '#2a78d6', series2: '#eb6834' };
const SURFACE = '#fcfcfb';
const TEXT = '#0b0b0b';
const TEXT_2 = '#52514e';
const GRID = '#e4e3df';
const FONT = 'font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"';

const W = 680, H = 340;
const M = { top: 56, right: 24, bottom: 52, left: 56 };
const PW = W - M.left - M.right, PH = H - M.top - M.bottom;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function frame(title: string, subtitle: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ${FONT} role="img" aria-label="${esc(title)}">
<rect width="${W}" height="${H}" rx="12" fill="${SURFACE}"/>
<text x="${M.left}" y="26" font-size="15" font-weight="700" fill="${TEXT}">${esc(title)}</text>
<text x="${M.left}" y="44" font-size="12" fill="${TEXT_2}">${esc(subtitle)}</text>
${body}
</svg>
`;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function yAxis(max: number, ticks = 4, fmt = (v: number) => String(Math.round(v))): string {
  let out = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (max * i) / ticks;
    const y = M.top + PH - (PH * i) / ticks;
    out += `<line x1="${M.left}" x2="${M.left + PW}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    out += `<text x="${M.left - 8}" y="${y + 4}" font-size="11" fill="${TEXT_2}" text-anchor="end">${fmt(v)}</text>`;
  }
  return out;
}

/** Bar with 4 px rounded data end, square at the baseline. */
function bar(x: number, w: number, y: number, h: number, color: string): string {
  if (h <= 0) return '';
  const r = Math.min(4, h, w / 2);
  const b = y + h;
  return `<path d="M${x},${b} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${b} Z" fill="${color}"/>`;
}

/** One series of bars with a value label on each bar. */
export function barChart(opts: { title: string, subtitle: string, categories: string[], values: number[], labels: string[], color?: string }): string {
  const max = niceMax(Math.max(...opts.values));
  const slot = PW / opts.categories.length;
  const bw = Math.min(90, slot * 0.55);
  let body = yAxis(max);
  opts.categories.forEach((c, i) => {
    const h = (PH * opts.values[i]) / max;
    const x = M.left + slot * i + (slot - bw) / 2;
    const y = M.top + PH - h;
    body += bar(x, bw, y, h, opts.color ?? COLORS.series1);
    body += `<text x="${x + bw / 2}" y="${y - 6}" font-size="12" font-weight="700" fill="${TEXT}" text-anchor="middle">${esc(opts.labels[i])}</text>`;
    body += `<text x="${x + bw / 2}" y="${M.top + PH + 20}" font-size="12" fill="${TEXT_2}" text-anchor="middle">${esc(c)}</text>`;
  });
  body += `<line x1="${M.left}" x2="${M.left + PW}" y1="${M.top + PH}" y2="${M.top + PH}" stroke="${TEXT_2}" stroke-width="1"/>`;
  return frame(opts.title, opts.subtitle, body);
}

/** Two series of grouped bars with a legend and value labels. */
export function groupedBarChart(opts: { title: string, subtitle: string, categories: string[], series: { name: string, values: number[], color: string }[], fmt?: (v: number) => string }): string {
  const fmt = opts.fmt ?? ((v: number) => v.toFixed(1));
  const max = niceMax(Math.max(...opts.series.flatMap(s => s.values)));
  const slot = PW / opts.categories.length;
  const bw = Math.min(56, (slot * 0.7) / opts.series.length);
  const gap = 2;
  let body = yAxis(max, 4, v => (v % 1 === 0 ? String(v) : v.toFixed(1)));
  opts.categories.forEach((c, i) => {
    const groupW = bw * opts.series.length + gap * (opts.series.length - 1);
    const x0 = M.left + slot * i + (slot - groupW) / 2;
    opts.series.forEach((s, j) => {
      const h = (PH * s.values[i]) / max;
      const x = x0 + j * (bw + gap);
      const y = M.top + PH - h;
      body += bar(x, bw, y, h, s.color);
      body += `<text x="${x + bw / 2}" y="${y - 6}" font-size="11" fill="${TEXT}" text-anchor="middle">${fmt(s.values[i])}</text>`;
    });
    body += `<text x="${M.left + slot * i + slot / 2}" y="${M.top + PH + 20}" font-size="12" fill="${TEXT_2}" text-anchor="middle">${esc(c)}</text>`;
  });
  body += `<line x1="${M.left}" x2="${M.left + PW}" y1="${M.top + PH}" y2="${M.top + PH}" stroke="${TEXT_2}" stroke-width="1"/>`;
  // Legend (top right)
  let lx = M.left + PW;
  for (const s of [...opts.series].reverse()) {
    const w = 18 + s.name.length * 7;
    lx -= w + 12;
    body += `<rect x="${lx}" y="16" width="10" height="10" rx="2" fill="${s.color}"/><text x="${lx + 15}" y="25" font-size="12" fill="${TEXT}">${esc(s.name)}</text>`;
  }
  return frame(opts.title, opts.subtitle, body);
}

/** Single line with markers and an end label. */
export function lineChart(opts: { title: string, subtitle: string, xs: number[], ys: number[], xLabel: string, yMin?: number, endLabel: string }): string {
  const yMin = opts.yMin ?? 0;
  const max = niceMax(Math.max(...opts.ys));
  const xMax = Math.max(...opts.xs);
  const sx = (x: number) => M.left + (PW * x) / xMax;
  const sy = (y: number) => M.top + PH - (PH * (y - yMin)) / (max - yMin);
  let body = '';
  for (let i = 0; i <= 4; i++) {
    const v = yMin + ((max - yMin) * i) / 4;
    const y = sy(v);
    body += `<line x1="${M.left}" x2="${M.left + PW}" y1="${y}" y2="${y}" stroke="${GRID}"/>`;
    body += `<text x="${M.left - 8}" y="${y + 4}" font-size="11" fill="${TEXT_2}" text-anchor="end">${Math.round(v)}</text>`;
  }
  for (const x of opts.xs.filter((_, i) => i % 4 === 0)) {
    body += `<text x="${sx(x)}" y="${M.top + PH + 20}" font-size="11" fill="${TEXT_2}" text-anchor="middle">${x}</text>`;
  }
  body += `<text x="${M.left + PW / 2}" y="${H - 10}" font-size="12" fill="${TEXT_2}" text-anchor="middle">${esc(opts.xLabel)}</text>`;
  body += `<line x1="${M.left}" x2="${M.left + PW}" y1="${M.top + PH}" y2="${M.top + PH}" stroke="${TEXT_2}"/>`;
  const pts = opts.xs.map((x, i) => `${sx(x)},${sy(opts.ys[i])}`).join(' ');
  body += `<polyline points="${pts}" fill="none" stroke="${COLORS.series1}" stroke-width="2" stroke-linejoin="round"/>`;
  opts.xs.forEach((x, i) => {
    body += `<circle cx="${sx(x)}" cy="${sy(opts.ys[i])}" r="4" fill="${COLORS.series1}" stroke="${SURFACE}" stroke-width="2"/>`;
  });
  const lastX = sx(opts.xs[opts.xs.length - 1]);
  const lastY = sy(opts.ys[opts.ys.length - 1]);
  body += `<text x="${lastX - 6}" y="${lastY - 10}" font-size="12" font-weight="700" fill="${TEXT}" text-anchor="end">${esc(opts.endLabel)}</text>`;
  return frame(opts.title, opts.subtitle, body);
}
