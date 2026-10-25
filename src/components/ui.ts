/**
 * Shared class names so every screen uses the same buttons, panels and text styles.
 * Tokens (colors, fonts) live in src/app/globals.css.
 */

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const base = `inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${focus}`;

export const btn = {
  primary: `${base} bg-accent text-on-accent hover:bg-accent-hover`,
  secondary: `${base} border border-line-strong bg-raised text-ink hover:bg-hover`,
  ghost: `${base} text-muted hover:text-ink hover:bg-raised`,
  danger: `${base} border border-danger/40 text-danger hover:bg-danger/10`,
};

export const panel = 'rounded-2xl border border-line bg-surface';

/** Small section label above a group of controls. */
export const sectionLabel = 'text-xs font-semibold text-muted';

/** Page-level heading (display face, sentence case). */
export const pageTitle = 'font-display text-3xl md:text-4xl font-semibold text-ink';

/** Selectable option card (difficulty, color, time, room). */
export const optionCard = (selected: boolean) =>
  `text-left rounded-2xl border p-5 transition-colors ${focus} ${selected ? 'border-accent bg-accent/10' : 'border-line bg-surface hover:border-line-strong hover:bg-raised'}`;

/** Full-screen backdrop for dialogs. */
export const backdrop = 'fixed inset-0 flex items-center justify-center p-4 md:p-6 bg-canvas/85';

/** Dialog card. */
export const dialog = 'w-full rounded-2xl border border-line bg-surface p-6 md:p-8 shadow-2xl shadow-black/40';
