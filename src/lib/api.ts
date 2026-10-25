import type { Category } from '@/core/calendar/rules';
import type { AudienceEntry, DepartmentInfo, FacultyInfo, Structure } from '@/core/calendar/types';

export interface Person {
  id: number;
  name: string;
}

/** Item of GET /api/holidays: a one-off holiday or one occurrence of a yearly rule. */
export interface PublicHoliday {
  id: number | string; // "rule:<ruleId>:<year>" for yearly rules
  title: string;
  note: string | null;
  category: Category;
  classesOnly: boolean;
  startDate: string;
  endDate: string;
  audience: AudienceEntry[];
  label: string;
  source: 'ONE_OFF' | 'RULE';
  tentative: boolean;
  ruleId?: number;
  year?: number;
  updatedBy: { name: string };
  updatedAt: string;
}

/** Admin view of one one-off holiday. */
export interface FullHoliday extends Omit<PublicHoliday, 'updatedBy' | 'id'> {
  id: number;
  createdBy: Person;
  createdAt: string;
  updatedBy: Person;
  deletedAt: string | null;
}

export interface Conflict {
  id: number | string;
  source: 'ONE_OFF' | 'RULE';
  title: string;
  note: string | null;
  startDate: string;
  endDate: string;
  label: string;
  updatedBy: Person;
  updatedAt: string;
  overlap: { startDate: string; endDate: string };
  sharedLabel: string;
}

export interface AuditEntry {
  id: number;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';
  entityType?: string;
  admin: Person;
  at: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** GET /api/structure, plus names for display. Series there are active-only. */
export interface ApiStructure extends Structure {
  faculties: (FacultyInfo & { name: string })[];
  departments: (DepartmentInfo & { name: string })[];
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string; conflicts?: Conflict[] };

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.method && init.method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    return {
      ok: false,
      status: res.status,
      code: json?.error?.code ?? 'ERROR',
      message: json?.error?.message ?? 'Something went wrong.',
      conflicts: json?.conflicts,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: 'NETWORK',
      message: 'Network error. Check your connection.',
    };
  }
}

// --- Holidays: cached per range so prefetching the neighbouring months is instant ---------

const cache = new Map<string, Promise<PublicHoliday[]>>();

/**
 * `bust` adds a throwaway query param so the admin never sees the 60 s CDN copy.
 * Failed requests are not cached.
 */
export function loadHolidays(from: string, to: string, bust = false): Promise<PublicHoliday[]> {
  const key = `${from}|${to}`;
  let p = cache.get(key);
  if (!p) {
    const extra = bust ? `&_=${Date.now()}` : '';
    p = api<{ holidays: PublicHoliday[] }>(`/api/holidays?from=${from}&to=${to}${extra}`).then(
      (r) => {
        if (!r.ok) throw new Error(r.message);
        return r.data.holidays;
      },
    );
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export const clearHolidayCache = () => cache.clear();

let structurePromise: Promise<ApiStructure> | null = null;

export function loadStructure(): Promise<ApiStructure> {
  structurePromise ??= api<
    Omit<ApiStructure, 'series'> & { series: Omit<ApiStructure['series'][number], 'isActive'>[] }
  >('/api/structure').then((r) => {
    if (!r.ok) {
      structurePromise = null;
      throw new Error(r.message);
    }
    // /api/structure only returns active series.
    return { ...r.data, series: r.data.series.map((s) => ({ ...s, isActive: true })) };
  });
  return structurePromise;
}
