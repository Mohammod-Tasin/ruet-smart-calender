'use client';
import { useEffect, useState } from 'react';
import type { AudienceEntry } from '@/core/calendar/types';
import { api, type Conflict } from '@/lib/api';
import { audienceText } from '@/lib/format';
import { rangeText } from '@/lib/journey-ui';

/**
 * Debounced overlap check while the form is being filled. `setConflicts` lets the form show the
 * conflicts of a 409 too. Nothing is checked until dates and audience are valid.
 */
export function useOverlap(
  ready: boolean,
  startDate: string,
  endDate: string,
  audience: AudienceEntry[],
  excludeId?: number,
) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [checking, setChecking] = useState(false);
  const audienceKey = JSON.stringify(audience);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const t = setTimeout(async () => {
      setChecking(true);
      const r = await api<{ conflicts: Conflict[] }>('/api/admin/holidays/check-overlap', {
        method: 'POST',
        body: {
          title: 'check', // required by the shared schema, irrelevant to overlap
          startDate,
          endDate,
          audience: JSON.parse(audienceKey),
          excludeId,
        },
      });
      if (!live) return;
      setChecking(false);
      setConflicts(r.ok ? r.data.conflicts : []);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ready, startDate, endDate, audienceKey, excludeId]);

  return { conflicts: ready ? conflicts : [], checking: ready && checking, setConflicts };
}

/**
 * The overlap warning as ONE line: the first clash, and how many more. Choices: edit the
 * existing holiday (button here), save anyway (the form's main button), or cancel.
 */
export function OverlapLine({
  conflicts,
  checking,
  onEdit,
}: {
  conflicts: Conflict[];
  checking: boolean;
  onEdit: (id: number) => void;
}) {
  const c = conflicts[0];
  return (
    <div aria-live="polite">
      {checking && !c && <p className="text-sm text-zinc-500">Checking for overlaps…</p>}
      {c && (
        <p className="rounded-lg border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          <span aria-hidden>⚠ </span>
          <b>{c.title}</b> is already set for {audienceText(c.sharedLabel)} (
          {rangeText(c.overlap.startDate, c.overlap.endDate)})
          {conflicts.length > 1 && ` and ${conflicts.length - 1} more`}
          {c.source === 'ONE_OFF' && typeof c.id === 'number' ? (
            <>
              {' '}
              <button
                type="button"
                onClick={() => onEdit(c.id as number)}
                className="font-medium underline"
              >
                Edit that one
              </button>
            </>
          ) : (
            ' (change it in Yearly holidays)'
          )}
        </p>
      )}
    </div>
  );
}
