'use client';
import { useEffect, useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { isRealDate } from '@/core/validation/holidays-query';
import { api, type ApiStructure, type FullHoliday } from '@/lib/api';
import { stamp } from '@/lib/format';
import { AudienceChips } from './AudienceChips';
import { ImpactPreview } from './ImpactPreview';
import { OverlapLine, useOverlap } from './OverlapLine';
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
          setBy: `তৈরি: ${h.createdBy.name} · ${stamp(h.createdAt)}। সর্বশেষ সম্পাদনা: ${h.updatedBy.name} · ${stamp(h.updatedAt)}।`,
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
    body = <p className="text-sm">লোড হচ্ছে…</p>;
  }

  return (
    <Sheet title={target.kind === 'new' ? 'ছুটি দিন' : 'ছুটি সম্পাদনা'} onClose={rest.onClose}>
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const audience = useMemo(() => audienceFromSeries(selected, structure), [selected, structure]);
  const datesOk = isRealDate(start) && isRealDate(end) && end >= start;
  const checkable = datesOk && audience.length > 0;
  const {
    conflicts: shown,
    checking,
    setConflicts,
  } = useOverlap(checkable, start, end, audience, initial.excludeId);
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

  async function save() {
    setError(null);
    if (!title.trim()) return setError('শিরোনাম লিখুন।');
    if (!datesOk) return setError('শুরু ও শেষের সঠিক তারিখ দিন (শেষ তারিখ শুরুর আগে হবে না)।');
    if (audience.length === 0) return setError('কারা ছুটিতে তা বেছে নিন।');

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
      if (Object.keys(patch).length === 0) return onDone('বদলানোর মতো কিছু নেই।');
      request = api(`/api/admin/holidays/${initial.excludeId}`, {
        method: 'PATCH',
        body: { ...patch, confirmOverlap },
      });
    }
    setSaving(true);
    const r = await request;
    setSaving(false);
    if (r.ok) return onDone(editing ? 'ছুটি বদলানো হয়েছে।' : 'ছুটি যোগ হয়েছে।');
    if (r.code === 'OVERLAP' && r.conflicts) {
      setConflicts(r.conflicts);
      return setError('অন্য ছুটির সাথে মিলে যাচ্ছে। দেখে নিয়ে "তবুও সংরক্ষণ" চাপুন।');
    }
    setError(r.status === 401 ? 'সেশন শেষ হয়ে গেছে। আবার লগইন করুন।' : r.message);
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
        শিরোনাম
        <input
          className={field}
          value={title}
          maxLength={100}
          required
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium">
        নোট <span className="font-normal text-zinc-500">(কারণ; সবাই দেখবে)</span>
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
          শুরু
          <input
            type="date"
            className={field}
            value={start}
            required
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium">
          শেষ
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

      <AudienceChips structure={structure} selected={selected} onChange={setSelected} />

      <OverlapLine conflicts={shown} checking={checking} onEdit={onEditExisting} />

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
          {saving ? 'সংরক্ষণ হচ্ছে…' : shown.length ? 'তবুও সংরক্ষণ' : 'সংরক্ষণ'}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium disabled:opacity-60 dark:border-zinc-700"
        >
          বাতিল
        </button>
      </div>
    </form>
  );
}
