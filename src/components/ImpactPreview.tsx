'use client';
import { useEffect, useState } from 'react';
import type { ImpactGroup, ProposedChange } from '@/core/journey/impact';
import { api } from '@/lib/api';
import { dayText, PHASE_LABEL, seriesName, weeksText } from '@/lib/journey-ui';

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

const weeks = (n: number) => weeksText(Math.abs(n));

/** "CSE-23, EEE-23 and 2 more: semesters will move 1 week later" */
export function impactLine(groups: ImpactGroup[]): string {
  const labels = groups.flatMap((g) => g.labels.map(seriesName));
  const shifts = new Set(groups.map((g) => g.endShiftWeeks ?? 0));
  const names =
    labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` and ${labels.length - 3} more` : '');
  const [shift] = [...shifts];
  const what =
    shifts.size !== 1 || !shift
      ? 'the schedule will change'
      : `the semester will move ${weeks(shift)} ${shift > 0 ? 'later' : 'earlier'}`;
  return `${names}: ${what}`;
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
                : 'schedule changes'}
              {finals?.before && finals.after && (
                <>
                  {' '}
                  · {PHASE_LABEL.EXAM} {dayText(finals.before)} → {dayText(finals.after)}
                </>
              )}
            </p>
            {g.changes.length > 1 && (
              <details className="text-xs text-zinc-600 dark:text-zinc-400">
                <summary className="cursor-pointer">All stages</summary>
                <ul className="mt-1 space-y-0.5">
                  {g.changes.map((c) => (
                    <li key={c.segment}>
                      {PHASE_LABEL[c.phase]}: {c.before ? dayText(c.before) : '—'} →{' '}
                      {c.after ? dayText(c.after) : '—'}
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

/**
 * Two-step save for forms: when the change would shift a semester, the first submit only "arms"
 * the form (the button turns into "Confirm and save"); the second submit goes through.
 * Editing the dates un-arms it, because the key (the change itself) differs.
 */
export function useShiftConfirm(change: ProposedChange | null) {
  const impact = useImpact(change);
  const key = hasChange(change) ? JSON.stringify(change) : '';
  const [armed, setArmed] = useState('');
  const shifts = !!impact.groups?.length;
  return {
    impact,
    armed: shifts && armed === key,
    /** true = go ahead and save; false = the form just asked for confirmation. */
    proceed: () => {
      if (!shifts || armed === key) return true;
      setArmed(key);
      return false;
    },
  };
}

/** What the change does to running semesters, as ONE line. Nothing until there is a change. */
export function ImpactPreview({
  change,
  impact,
}: {
  change: ProposedChange | null;
  impact?: ReturnType<typeof useImpact>;
}) {
  const own = useImpact(impact ? null : change);
  const { active, loading, groups, error } = impact ?? own;
  if (!active) return null;
  return (
    <p
      aria-live="polite"
      className="rounded-lg border border-sky-300 bg-sky-50 p-2 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-50"
    >
      {loading
        ? 'Checking the effect on semesters…'
        : error
          ? `Could not check the effect on semesters (${error})`
          : groups && groups.length > 0
            ? `Effect on semesters: ${impactLine(groups)}.`
            : 'No running semester will move.'}
    </p>
  );
}
