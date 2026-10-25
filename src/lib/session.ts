const SESSION_KEY = 'chessflow_session';
const NAME_KEY = 'chessflow_username';

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('-');
}

/** This browser's anonymous session id (kept in localStorage). It identifies the seat you hold in a room. */
export function getSessionId(): string {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid || !/^[A-Za-z0-9-]{6,100}$/.test(sid)) {
    sid = randomId();
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export function getSavedName(): string {
  return localStorage.getItem(NAME_KEY) || '';
}

export function saveName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

const GUIDE_KEY = 'chessflow_guide_seen';

/** Has this browser finished the How-to-Play guide before? (then a short "Ready?" card is shown instead) */
export function hasSeenGuide(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGuideSeen(): void {
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    // ignore
  }
}
