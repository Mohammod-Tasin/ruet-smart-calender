'use client';
import { useEffect, useState } from 'react';
import type { AudienceEntry } from '@/core/calendar/types';
import { api, type Conflict } from '@/lib/api';
import { audienceText, stamp } from '@/lib/format';
import { small } from './ui';
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
          {` · set by ${c.updatedBy.name}, ${stamp(c.updatedAt)}`}
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

/**
 * The 409 OVERLAP answer for forms without a live check (the add form): one card per clash with
 * who set it and when, and the three choices: edit the existing holiday, save anyway (resends
 * with `confirmOverlap`), or cancel (drops the warning, nothing is saved).
 */
export function OverlapCard({
  conflicts,
  busy,
  onEdit,
  onSaveAnyway,
  onCancel,
}: {
  conflicts: Conflict[];
  busy?: boolean;
  /** Omit where there is no editor to open; the card then just names the clash. */
  onEdit?: (id: number) => void;
  onSaveAnyway: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50"
    >
      <p className="font-medium">
        This overlaps{' '}
        {conflicts.length === 1 ? 'another holiday' : `${conflicts.length} other holidays`}:
      </p>
      <ul className="space-y-1.5">
        {conflicts.slice(0, 3).map((c) => (
          <li key={c.id}>
            <b>{c.title}</b> · {audienceText(c.sharedLabel)} ·{' '}
            {rangeText(c.overlap.startDate, c.overlap.endDate)}
            <br />
            <span className="text-xs opacity-80">
              Set by {c.updatedBy.name} · {stamp(c.updatedAt)}
            </span>
            {!onEdit ? null : c.source === 'ONE_OFF' && typeof c.id === 'number' ? (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => onEdit(c.id as number)}
                  className="text-xs font-medium underline"
                >
                  Edit existing
                </button>
              </>
            ) : (
              <span className="text-xs"> (change it in Yearly holidays)</span>
            )}
          </li>
        ))}
        {conflicts.length > 3 && <li className="text-xs">…and {conflicts.length - 3} more</li>}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSaveAnyway}
          className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save anyway'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={small}>
          Cancel
        </button>
      </div>
    </div>
  );
}
