'use client';
import { useEffect, useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import type { Category } from '@/core/calendar/rules';
import { isRealDate } from '@/core/validation/holidays-query';
import { api, type ApiStructure, type FullHoliday } from '@/lib/api';
import { stamp } from '@/lib/format';
import { AudienceChips } from './AudienceChips';
import { ImpactPreview } from './ImpactPreview';
import { OverlapLine, useOverlap } from './OverlapLine';
import { Sheet } from './Sheet';
import { PastNote } from './PastConfirm';

export type EditorTarget =
  | { kind: 'new'; start: string; end: string; initialCategory?: Category; initialTitle?: string }
  | { kind: 'edit'; id: number };

interface Initial {
  title: string;
  note: string;
  category?: Category;
  classesOnly: boolean;
  start: string;
  end: string;
  selected: Set<number>;
  excludeId?: number;
  setBy?: string;
}

const field =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';
const sameSet = (a: Set<number>, b: Set<number>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

interface FormProps {
  structure: ApiStructure;
  offDays?: number[];
  onClose: () => void;
  onDone: (message: string) => void;
  onEditExisting: (id: number) => void;
}

/** Loads the holiday when editing, then shows the form. */
export function HolidayEditor({ target, ...rest }: FormProps & { target: EditorTarget }) {
  const [loaded, setLoaded] = useState<{ holiday?: FullHoliday; error?: string } | null>(null);
  const editId = target.kind === 'edit' ? target.id : null;

  useEffect(() => {
    if (editId === null) return;
    let live = true;
    api<{ holiday: FullHoliday }>(`/api/admin/holidays/${editId}`).then((r) => {
      if (live) setLoaded(r.ok ? { holiday: r.data.holiday } : { error: r.message });
    });
    return () => {
      live = false;
    };
  }, [editId]);

  let body: React.ReactNode;
  if (target.kind === 'new') {
    const isDeptBreak =
      target.initialCategory === 'UNOFFICIAL_BREAK' ||
      target.initialCategory === 'MID_BREAK' ||
      target.initialCategory === 'SEMESTER_BREAK';
    body = (
      <HolidayForm
        {...rest}
        initial={{
          title: target.initialTitle ?? '',
          note: '',
          category: target.initialCategory ?? 'HOLIDAY',
          classesOnly: isDeptBreak,
          start: target.start,
          end: target.end,
          selected: isDeptBreak ? new Set() : new Set(rest.structure.series.map((s) => s.id)),
        }}
      />
    );
  } else if (loaded?.holiday) {
    const h = loaded.holiday;
    body = (
      <HolidayForm
        {...rest}
        initial={{
          title: h.title,
          note: h.note ?? '',
          category: h.category,
          classesOnly: h.classesOnly,
          start: h.startDate,
          end: h.endDate,
          selected: coveredSeriesIds(h.audience, rest.structure),
          excludeId: h.id,
          setBy: `Created by ${h.createdBy.name} on ${stamp(h.createdAt)}. Last edited by ${h.updatedBy.name} on ${stamp(h.updatedAt)}.`,
        }}
      />
    );
  } else if (loaded?.error) {
    body = (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {loaded.error}
      </p>
    );
  } else {
    body = <p className="text-sm">Loading…</p>;
  }

  return (
    <Sheet
      title={target.kind === 'new' ? 'Add holiday / break' : 'Edit holiday / break'}
      onClose={rest.onClose}
    >
      {body}
    </Sheet>
  );
}

function HolidayForm({
  structure,
  initial,
  onClose,
  onDone,
  onEditExisting,
}: FormProps & { initial: Initial }) {
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note);
  const [category, setCategory] = useState<Category>(initial.category ?? 'HOLIDAY');
  const [classesOnly, setClassesOnly] = useState(initial.classesOnly);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [selected, setSelected] = useState(initial.selected);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastMsg, setPastMsg] = useState<string | null>(null);

  const audience = useMemo(() => audienceFromSeries(selected, structure), [selected, structure]);
  const datesOk = isRealDate(start) && isRealDate(end) && end >= start;
  const checkable = datesOk && audience.length > 0;
  const {
    conflicts: shown,
    checking,
    setConflicts,
  } = useOverlap(checkable, start, end, audience, initial.excludeId);
  const impactChange = useMemo(
    () =>
      checkable && category !== 'MID_BREAK' && category !== 'SEMESTER_BREAK'
        ? {
            removeIds: initial.excludeId ? [initial.excludeId] : undefined,
            add: [{ startDate: start, endDate: end, audience }],
          }
        : null,
    [checkable, category, initial.excludeId, start, end, audience],
  );

  async function save() {
    setError(null);
    if (!title.trim()) return setError('Enter a title.');
    if (!datesOk) return setError('Enter valid From and To dates (To cannot be before From).');
    if (audience.length === 0) return setError('Choose who is off.');

    const confirmOverlap = shown.length > 0 ? true : undefined;
    const confirmPast = pastMsg ? true : undefined;
    const editing = initial.excludeId !== undefined;
    let request: Promise<Awaited<ReturnType<typeof api>>>;
    if (!editing) {
      request = api('/api/admin/holidays', {
        method: 'POST',
        body: {
          title,
          note,
          category,
          classesOnly,
          startDate: start,
          endDate: end,
          audience,
          confirmOverlap,
          confirmPast,
        },
      });
    } else {
      const patch: Record<string, unknown> = {};
      if (title !== initial.title) patch.title = title;
      if (note !== initial.note) patch.note = note;
      if (category !== initial.category) patch.category = category;
      if (classesOnly !== initial.classesOnly) patch.classesOnly = classesOnly;
      if (start !== initial.start) patch.startDate = start;
      if (end !== initial.end) patch.endDate = end;
      if (!sameSet(selected, initial.selected)) patch.audience = audience;
      if (Object.keys(patch).length === 0) return onDone('Nothing to change.');
      request = api(`/api/admin/holidays/${initial.excludeId}`, {
        method: 'PATCH',
        body: { ...patch, confirmOverlap, confirmPast },
      });
    }
    setSaving(true);
    const r = await request;
    setSaving(false);
    if (r.ok) {
      return onDone(editing ? 'Updated.' : 'Saved.');
    }
    if (r.code === 'PAST_CONFIRM') return setPastMsg(r.message);
    if (r.code === 'OVERLAP' && r.conflicts) {
      setConflicts(r.conflicts);
      return setError('This overlaps another holiday. Check it, then press "Save anyway".');
    }
    setError(r.status === 401 ? 'Your session expired. Please sign in again.' : r.message);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="space-y-4"
    >
      <div>
        <span className="mb-1 block text-sm font-medium">Type</span>
        <div className="flex flex-wrap gap-3 text-sm">
          {(
            [
              ['HOLIDAY', 'Common / Official Holiday'],
              ['MID_BREAK', 'Mid Break'],
              ['UNOFFICIAL_BREAK', 'Unofficial Break'],
              ['SEMESTER_BREAK', 'Semester Break'],
            ] as const
          ).map(([val, label]) => (
            <label key={val} className="flex cursor-pointer items-center gap-1.5">
              <input
                type="radio"
                name="holiday-category"
                value={val}
                checked={category === val}
                onChange={() => {
                  setCategory(val);
                  if (val !== 'HOLIDAY') setClassesOnly(true);
                }}
                className="accent-indigo-600"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      <label className="block text-sm font-medium">
        Title
        <input
          className={field}
          value={title}
          maxLength={100}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium">
        Note <span className="font-normal text-zinc-500">(optional; everyone can see it)</span>
        <textarea
          className={field}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-indigo-600"
          checked={classesOnly}
          onChange={(e) => setClassesOnly(e.target.checked)}
        />
        Classes off only <span className="text-zinc-500">(offices stay open)</span>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          From
          <input
            type="date"
            className={field}
            value={start}
            required
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          To
          <input
            type="date"
            className={field}
            value={end}
            required
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <AudienceChips structure={structure} selected={selected} onChange={setSelected} />

      <OverlapLine conflicts={shown} checking={checking} onEdit={onEditExisting} />

      <ImpactPreview change={impactChange} />

      {pastMsg && <PastNote message={pastMsg} />}
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {initial.setBy && <p className="text-xs text-zinc-500 dark:text-zinc-400">{initial.setBy}</p>}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <button
          disabled={saving}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${shown.length ? 'bg-amber-600' : 'bg-indigo-600'}`}
        >
          {saving
            ? 'Saving…'
            : pastMsg
              ? 'Fix a past holiday'
              : shown.length
                ? 'Save anyway'
                : 'Save'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
