import { useSyncExternalStore } from 'react';

// "আমার সিরিজ": department code + intake year, remembered in this browser only.
const KEY = 'my-series';
const EVENT = 'my-series-change';
export interface MySeries {
  dept: string;
  year: number;
}

// useSyncExternalStore needs a stable snapshot, so cache the raw string and parse it once.
let cachedRaw: string | null = null;
let cached: MySeries | null = null;
function snapshot(): MySeries | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return cached; // storage blocked: the choice lives in memory for this visit
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const v = raw ? JSON.parse(raw) : null;
      cached = v && typeof v.dept === 'string' && Number.isInteger(v.year) ? v : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

export const useMySeries = () => useSyncExternalStore(subscribe, snapshot, () => null);

export function setMySeries(v: MySeries | null) {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    cached = v;
  }
  window.dispatchEvent(new Event(EVENT));
}
