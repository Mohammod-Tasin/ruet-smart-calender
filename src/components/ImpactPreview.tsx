'use client';
import { useEffect, useState } from 'react';
import type { ImpactGroup, ProposedChange } from '@/core/journey/impact';
import { bnDigits } from '@/core/journey/journey';
import { api } from '@/lib/api';
import { bnDate, PHASE_BN, seriesName } from '@/lib/journey-ui';

/** The API refuses an empty change, so a change with nothing in it counts as "no change". */
export const hasChange = (c: ProposedChange | null): c is ProposedChange =>
  !!c && (c.removeIds?.length ?? 0) + (c.add?.length ?? 0) > 0;

/** Debounced "what would this do to the semesters?" for a proposed holiday change. */
export function useImpact(change: ProposedChange | null, delay = 400) {
  const key = hasChange(change) ? JSON.stringify(change) : '';
  const [state, setState] = useState<{
    key: string;
    groups?: ImpactGroup[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await api<{ groups: ImpactGroup[] }>('/api/admin/impact', {
        method: 'POST',
        body: JSON.parse(key),
      });
      if (live) setState(r.ok ? { key, groups: r.data.groups } : { key, error: r.message });
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, delay]);

  const current = state?.key === key ? state : null;
  return {
    active: !!key,
    loading: !!key && !current,
    groups: current?.groups,
    error: current?.error,
  };
}

const weeks = (n: number) => `${bnDigits(Math.abs(n))} সপ্তাহ`;

/** "CSE-২৩, EEE-২৩ ও আরও ২টি সিরিজের সেমিস্টার ১ সপ্তাহ পিছিয়ে যাবে" */
export function impactLine(groups: ImpactGroup[]): string {
  const labels = groups.flatMap((g) => g.labels.map(seriesName));
  const shifts = new Set(groups.map((g) => g.endShiftWeeks ?? 0));
  const names =
    labels.slice(0, 3).join(', ') +
    (labels.length > 3 ? ` ও আরও ${bnDigits(labels.length - 3)}টি` : '');
  const [shift] = [...shifts];
  const what =
    shifts.size !== 1 || !shift
      ? 'সময়সূচি বদলাবে'
      : `সেমিস্টার ${weeks(shift)} ${shift > 0 ? 'পিছিয়ে যাবে' : 'এগিয়ে আসবে'}`;
  return `${names} সিরিজের ${what}`;
}

/** Full breakdown, used where the admin must confirm (yearly dates). */
export function ImpactGroups({ groups }: { groups: ImpactGroup[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {groups.map((g) => {
        const finals = g.changes.find((c) => c.phase === 'EXAM');
        return (
          <li key={g.seriesIds.join(',')}>
            <p>
              <b>{g.labels.map(seriesName).join(', ')}</b>:{' '}
              {g.endShiftWeeks
                ? `${g.endShiftWeeks > 0 ? '+' : '−'}${weeks(g.endShiftWeeks)}`
                : 'সময়সূচি বদলাবে'}
              {finals?.before && finals.after && (
                <>
                  {' '}
                  · {PHASE_BN.EXAM} {bnDate(finals.before)} → {bnDate(finals.after)}
                </>
              )}
            </p>
            {g.changes.length > 1 && (
              <details className="text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">সব ধাপ</summary>
                <ul className="mt-1 space-y-0.5">
                  {g.changes.map((c) => (
                    <li key={c.segment}>
                      {PHASE_BN[c.phase]}: {c.before ? bnDate(c.before) : '—'} →{' '}
                      {c.after ? bnDate(c.after) : '—'}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** What the change does to running semesters, as ONE line. Nothing until there is a change. */
export function ImpactPreview({ change }: { change: ProposedChange | null }) {
  const { active, loading, groups, error } = useImpact(change);
  if (!active) return null;
  return (
    <p
      aria-live="polite"
      className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-50"
    >
      {loading
        ? 'সেমিস্টারে প্রভাব হিসাব করা হচ্ছে…'
        : error
          ? `প্রভাব দেখা যায়নি (${error})`
          : groups && groups.length > 0
            ? `সেমিস্টারে প্রভাব: ${impactLine(groups)}।`
            : 'চলমান কোনো সেমিস্টারের সময়সূচি বদলাবে না।'}
    </p>
  );
}
