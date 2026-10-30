'use client';
import { useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { addDays } from '@/core/calendar/hijri';
import { weekStartOf } from '@/core/journey/journey';
import { api, type ApiStructure } from '@/lib/api';
import { dayText } from '@/lib/journey-ui';
import { AudienceChips } from './AudienceChips';
import { ImpactPreview } from './ImpactPreview';
import { OverlapLine, useOverlap } from './OverlapLine';
import { Sheet } from './Sheet';
import { field, primary, small } from './ui';

/**
 * "Suspend classes this week": a Saturday-Wednesday week with no classes for some audience. It is an
 * ordinary holiday with category SUSPENDED_WEEK, so the journey engine needs no special case.
 */
export function SuspendSheet({
  structure,
  date,
  onClose,
  onEditExisting,
  onDone,
}: {
  structure: ApiStructure;
  /** Any day of the week to suspend. */
  date: string;
  onClose: () => void;
  onEditExisting: (id: number) => void;
  onDone: (message: string) => void;
}) {
  const start = weekStartOf(date);
  const end = addDays(start, 4); // Wednesday
  const [title, setTitle] = useState('Class Suspension');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audience = useMemo(() => audienceFromSeries(selected, structure), [selected, structure]);
  const ready = audience.length > 0;
  const { conflicts, checking, setConflicts } = useOverlap(ready, start, end, audience);
  const change = useMemo(
    () => (ready ? { add: [{ startDate: start, endDate: end, audience }] } : null),
    [ready, start, end, audience],
  );

  async function save() {
    setError(null);
    if (!title.trim()) return setError('Enter a title.');
    if (!ready) return setError('Choose who is off.');
    setSaving(true);
    const r = await api('/api/admin/holidays', {
      method: 'POST',
      body: {
        title,
        category: 'SUSPENDED_WEEK',
        startDate: start,
        endDate: end,
        audience,
        confirmOverlap: conflicts.length > 0 ? true : undefined,
      },
    });
    setSaving(false);
    if (r.ok) return onDone('Classes suspended for the week.');
    if (r.code === 'OVERLAP' && r.conflicts) {
      setConflicts(r.conflicts);
      return setError('This overlaps another holiday. Check it, then press "Save anyway".');
    }
    setError(r.status === 401 ? 'Your session expired. Please sign in again.' : r.message);
  }

  return (
    <Sheet title="Suspend classes this week" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="text-sm">
          The whole week, Saturday <b>{dayText(start)}</b> to Wednesday <b>{dayText(end)}</b>.
        </p>
        <label className="block text-sm font-medium">
          Title
          <input
            className={field}
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <AudienceChips structure={structure} selected={selected} onChange={setSelected} />
        <OverlapLine conflicts={conflicts} checking={checking} onEdit={onEditExisting} />
        <ImpactPreview change={change} />
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            disabled={saving}
            className={`${primary} ${conflicts.length ? 'bg-amber-600 hover:bg-amber-700' : ''}`}
          >
            {saving ? 'Saving…' : conflicts.length ? 'Save anyway' : 'Save'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className={`${small} px-4 py-2`}
          >
            Cancel
          </button>
        </div>
      </form>
    </Sheet>
  );
}
