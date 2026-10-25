'use client';
import { useEffect, useState } from 'react';
import type { ImpactGroup, ProposedChange } from '@/core/semester/impact';
import { api } from '@/lib/api';
import { bn } from '@/lib/rule-summary';
import { bnDate, PHASE_BN } from '@/lib/semester-ui';

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

const weeks = (n: number) => `${n > 0 ? '+' : '−'}${bn(Math.abs(n))} সপ্তাহ`;

/** "EEE-21, EEE-22: +১ সপ্তাহ · সেমিস্টার ফাইনাল ১৭ জানুয়ারি → ২৪ জানুয়ারি" */
export function ImpactGroups({ groups }: { groups: ImpactGroup[] }) {
  return (
    <ul className="space-y-2 text-sm">
      {groups.map((g) => {
        const finals = g.changes.find((c) => c.phase === 'FINALS');
        return (
          <li key={g.seriesIds.join(',')}>
            <p>
              <b>{g.labels.join(', ')}</b>:{' '}
              {g.endShiftWeeks ? weeks(g.endShiftWeeks) : 'সময়সূচি বদলাবে'}
              {finals?.before && finals.after && (
                <>
                  {' '}
                  · {PHASE_BN.FINALS} {bnDate(finals.before)} → {bnDate(finals.after)}
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

/** Impact box shown next to the overlap warning. Renders nothing until there is a change. */
export function ImpactPreview({ change }: { change: ProposedChange | null }) {
  const { active, loading, groups, error } = useImpact(change);
  if (!active) return null;
  return (
    <section
      aria-live="polite"
      aria-label="সেমিস্টারে প্রভাব"
      className="space-y-1 rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-800 dark:bg-sky-950"
    >
      <h3 className="text-sm font-semibold text-sky-900 dark:text-sky-100">সেমিস্টারে প্রভাব</h3>
      {loading ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">হিসাব করা হচ্ছে…</p>
      ) : error ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">প্রভাব দেখা যায়নি ({error})</p>
      ) : groups && groups.length > 0 ? (
        <ImpactGroups groups={groups} />
      ) : (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          চলমান কোনো সেমিস্টারের সময়সূচি বদলাবে না।
        </p>
      )}
    </section>
  );
}
