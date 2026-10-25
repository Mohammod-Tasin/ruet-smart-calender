'use client';
import { useEffect, useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { isRealDate } from '@/core/validation/holidays-query';
import { api, type ApiStructure, type Conflict, type FullHoliday } from '@/lib/api';
import { dateRange, stamp } from '@/lib/format';
import { AudiencePicker } from './AudiencePicker';
import { ImpactPreview } from './ImpactPreview';
import { Sheet } from './Sheet';
import { TrimHint } from './TrimHint';

export type EditorTarget =
  { kind: 'new'; start: string; end: string } | { kind: 'edit'; id: number };

interface Initial {
  title: string;
  note: string;
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
  offDays: number[];
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
    body = (
      <HolidayForm
        {...rest}
        initial={{
          title: '',
          note: '',
          classesOnly: false,
          start: target.start,
          end: target.end,
          selected: new Set(),
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
          classesOnly: h.classesOnly,
          start: h.startDate,
          end: h.endDate,
          selected: coveredSeriesIds(h.audience, rest.structure),
          excludeId: h.id,
          setBy: `Created by ${h.createdBy.name} · ${stamp(h.createdAt)}. Last edited by ${h.updatedBy.name} · ${stamp(h.updatedAt)}.`,
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
    <Sheet title={target.kind === 'new' ? 'New holiday' : 'Edit holiday'} onClose={rest.onClose}>
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
  offDays,
}: FormProps & { initial: Initial }) {
  const [title, setTitle] = useState(initial.title);
  const [note, setNote] = useState(initial.note);
  const [classesOnly, setClassesOnly] = useState(initial.classesOnly);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [selected, setSelected] = useState(initial.selected);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audience = useMemo(() => audienceFromSeries(selected, structure), [selected, structure]);
  const datesOk = isRealDate(start) && isRealDate(end) && end >= start;
  const checkable = datesOk && audience.length > 0;
  const shown = checkable ? conflicts : [];
  const audienceKey = JSON.stringify(audience);
  // What this save would do to the semesters (an edit replaces the old version of itself).
  const impactChange = useMemo(
    () =>
      checkable
        ? {
            removeIds: initial.excludeId ? [initial.excludeId] : undefined,
            add: [{ startDate: start, endDate: end, audience }],
          }
        : null,
    [checkable, initial.excludeId, start, end, audience],
  );

  // Debounced live overlap check while the admin edits dates or audience.
  useEffect(() => {
    if (!checkable) return;
    let live = true;
    const t = setTimeout(async () => {
      setChecking(true);
      const r = await api<{ conflicts: Conflict[] }>('/api/admin/holidays/check-overlap', {
        method: 'POST',
        body: {
          title: 'check', // required by the shared schema, irrelevant to overlap
          startDate: start,
          endDate: end,
          audience: JSON.parse(audienceKey),
          excludeId: initial.excludeId,
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
  }, [checkable, start, end, audienceKey, initial.excludeId]);

  async function save() {
    setError(null);
    if (!title.trim()) return setError('Please enter a title.');
    if (!datesOk)
      return setError('Please pick valid From and To dates (To must not be before From).');
    if (audience.length === 0) return setError('Please choose who is off.');

    const confirmOverlap = shown.length > 0 ? true : undefined;
    const editing = initial.excludeId !== undefined;
    let request: Promise<Awaited<ReturnType<typeof api>>>;
    if (!editing) {
      request = api('/api/admin/holidays', {
        method: 'POST',
        body: {
          title,
          note,
          classesOnly,
          startDate: start,
          endDate: end,
          audience,
          confirmOverlap,
        },
      });
    } else {
      // Send only what changed, so an unchanged audience/date never re-triggers the overlap rule.
      const patch: Record<string, unknown> = {};
      if (title !== initial.title) patch.title = title;
      if (note !== initial.note) patch.note = note;
      if (classesOnly !== initial.classesOnly) patch.classesOnly = classesOnly;
      if (start !== initial.start) patch.startDate = start;
      if (end !== initial.end) patch.endDate = end;
      if (!sameSet(selected, initial.selected)) patch.audience = audience;
      if (Object.keys(patch).length === 0) return onDone('No changes to save.');
      request = api(`/api/admin/holidays/${initial.excludeId}`, {
        method: 'PATCH',
        body: { ...patch, confirmOverlap },
      });
    }
    setSaving(true);
    const r = await request;
    setSaving(false);
    if (r.ok) return onDone(editing ? 'Holiday updated.' : 'Holiday created.');
    if (r.code === 'OVERLAP' && r.conflicts) {
      setConflicts(r.conflicts);
      return setError('This overlaps other holidays. Review them below, then press "Save anyway".');
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
        Note <span className="font-normal text-zinc-500">(why; shown to everyone)</span>
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
        শুধু ক্লাস বন্ধ <span className="text-zinc-500">(classes closed, offices open)</span>
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
      <TrimHint
        start={start}
        end={end}
        offDays={offDays}
        onTrim={(r) => {
          setStart(r.startDate);
          setEnd(r.endDate);
        }}
      />

      <AudiencePicker structure={structure} selected={selected} onChange={setSelected} />

      <div aria-live="polite">
        {checking && <p className="text-sm text-zinc-500">Checking for overlaps…</p>}
        {shown.length > 0 && (
          <section className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
              ⚠ Overlaps {shown.length === 1 ? 'another holiday' : `${shown.length} other holidays`}
            </h3>
            {shown.map((c) => (
              <ConflictCard
                key={c.id}
                c={c}
                onEdit={() => typeof c.id === 'number' && onEditExisting(c.id)}
              />
            ))}
          </section>
        )}
      </div>

      <ImpactPreview change={impactChange} />

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
          {saving ? 'Saving…' : shown.length ? 'Save anyway' : 'Save'}
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

function ConflictCard({ c, onEdit }: { c: Conflict; onEdit: () => void }) {
  return (
    <article className="rounded-md bg-white p-2 text-sm dark:bg-zinc-900">
      <p className="font-medium">{c.title}</p>
      <p className="text-zinc-600 dark:text-zinc-400">
        {c.label} · {dateRange(c.startDate, c.endDate)}
      </p>
      <p>
        Clash: <b>{c.sharedLabel}</b> on {dateRange(c.overlap.startDate, c.overlap.endDate)}
      </p>
      {c.note && <p className="whitespace-pre-line">{c.note}</p>}
      <p className="text-xs text-zinc-500">
        Set by {c.updatedBy.name} · {stamp(c.updatedAt)}
      </p>
      {c.source === 'RULE' ? (
        <p className="mt-1 text-xs text-zinc-500">
          Yearly holiday: change it on the Yearly holidays page.
        </p>
      ) : (
        <button
          type="button"
          onClick={onEdit}
          className="mt-1 rounded border border-zinc-300 px-2 py-1 text-xs font-medium dark:border-zinc-700"
        >
          Edit existing
        </button>
      )}
    </article>
  );
}
