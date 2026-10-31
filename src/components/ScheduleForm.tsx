'use client';
import { useState } from 'react';
import { addDays } from '@/core/calendar/hijri';
import { scheduleProblem, type ScheduleFields } from '@/core/journey/schedule';
import { dayText } from '@/lib/journey-ui';
import { field, primary, small } from './ui';

const KEYS: { key: keyof ScheduleFields; label: string }[] = [
  { key: 'classesBefore', label: 'Class weeks before the mid-term break' },
  { key: 'classesAfter', label: 'Class weeks after it' },
  { key: 'vivaWeeks', label: 'Board Viva weeks' },
  { key: 'finalWeeks', label: 'Semester Final weeks' },
];

/**
 * The expected mid-term break start if the classes before it are `n` weeks, given where it is
 * expected now (`start` after `before` weeks). ponytail: counts plain weeks, so a holiday week
 * in between would move the real date by one more; the saved journey is always exact.
 */
export const breakStartFor = (start: string | null, before: number, n: number) =>
  start ? addDays(start, (n - before) * 7) : null;

/** The four schedule numbers of one semester, with the class total and a live "break starts" line. */
export function ScheduleForm({
  initial,
  expectedBreak,
  busy,
  saveLabel = 'Save',
  onSave,
  onCancel,
}: {
  initial: ScheduleFields;
  /** Where the break is expected now (after `initial.classesBefore` class weeks), if known. */
  expectedBreak?: string | null;
  busy?: boolean;
  saveLabel?: string;
  onSave: (f: ScheduleFields) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState(initial);
  const problem = scheduleProblem(f);
  const date = breakStartFor(expectedBreak ?? null, initial.classesBefore, f.classesBefore);
  const unchanged = JSON.stringify(f) === JSON.stringify(initial);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) onSave(f);
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        {KEYS.map(({ key, label }) => (
          <label key={key} className="block text-sm font-medium">
            {label}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              className={field}
              value={Number.isNaN(f[key]) ? '' : f[key]}
              onChange={(e) => setF({ ...f, [key]: e.target.valueAsNumber })}
            />
          </label>
        ))}
      </div>
      <p className="text-sm" aria-live="polite">
        Total {f.classesBefore + f.classesAfter || 0} class weeks.{' '}
        {problem ? (
          <span className="text-red-700 dark:text-red-400">{problem}</span>
        ) : date ? (
          <>
            Mid-term break will start Sat {dayText(date)} (after class week {f.classesBefore}).
          </>
        ) : (
          <>Mid-term break will come after class week {f.classesBefore}.</>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy || !!problem || unchanged}>
          {busy ? 'Saving…' : saveLabel}
        </button>
        {onCancel && (
          <button type="button" className={`${small} py-2`} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
