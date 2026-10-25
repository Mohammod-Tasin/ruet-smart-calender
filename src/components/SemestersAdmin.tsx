'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { DEFAULT_TEMPLATE, type Phase, type Template } from '@/core/semester/timeline';
import { api, type ApiStructure } from '@/lib/api';
import { useStructure } from '@/lib/hooks';
import { bn } from '@/lib/rule-summary';
import {
  bnDate,
  nextLineBn,
  PHASE_BN,
  PHASE_STYLE,
  stateLineBn,
  type AdminSemester,
  type StatusEntry,
  type StatusResponse,
} from '@/lib/semester-ui';
import { SemesterDetail } from './SemesterDetail';
import { SeriesSelect } from './SeriesSelect';
import { Sheet } from './Sheet';
import { TemplateEditor } from './TemplateEditor';
import { ThemeToggle } from './ThemeToggle';
import { ToastProvider, useToast } from './Toast';
import { field, primary, small } from './ui';

export function SemestersAdmin() {
  return (
    <ToastProvider>
      <Semesters />
    </ToastProvider>
  );
}

type Dialog =
  | { kind: 'start'; preselect: number[] }
  | { kind: 'checkpoint' }
  | { kind: 'detail'; semesterId: number; seriesId: number; name: string };

const seriesName = (s: ApiStructure, id: number) => {
  const row = s.series.find((x) => x.id === id);
  const dept = row && s.departments.find((d) => d.id === row.departmentId);
  return row && dept ? `${dept.code}-${String(row.intakeYear % 100).padStart(2, '0')}` : `#${id}`;
};

function Semesters() {
  const router = useRouter();
  const toast = useToast();
  const today = useMemo(() => todayInDhaka(), []);
  const { structure } = useStructure();
  const [list, setList] = useState<AdminSemester[] | null>(null);
  const [status, setStatus] = useState<StatusEntry[]>([]);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deptCode, setDeptCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ semesters: AdminSemester[] }>('/api/admin/semesters'),
      api<StatusResponse>(`/api/status?date=${today}&t=${Date.now()}`),
    ]).then(([a, s]) => {
      if (!live) return;
      if (!a.ok) {
        if (a.status === 401) router.replace('/admin/login');
        else setError(a.message);
        return;
      }
      setError(null);
      setList(a.data.semesters);
      if (s.ok) setStatus(s.data.series);
    });
    return () => {
      live = false;
    };
  }, [today, version, router]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const done = (message: string) => {
    toast(message);
    setDialog(null);
    reload();
  };

  const active = useMemo(
    () => new Map((list ?? []).filter((s) => s.status === 'ACTIVE').map((s) => [s.seriesId, s])),
    [list],
  );
  const entries = useMemo(() => new Map(status.map((e) => [e.seriesId, e])), [status]);

  const rows = useMemo(() => {
    if (!structure) return [];
    return structure.departments
      .filter((d) => !deptCode || d.code === deptCode)
      .flatMap((d) =>
        structure.series
          .filter((s) => s.departmentId === d.id)
          .sort((a, b) => b.intakeYear - a.intakeYear)
          .map((s) => ({ s, name: seriesName(structure, s.id) })),
      );
  }, [structure, deptCode]);

  const free = structure ? structure.series.filter((s) => !active.has(s.id)) : [];

  return (
    <main className="mx-auto max-w-5xl space-y-4 px-2 py-3 sm:px-4">
      <header className="flex flex-wrap items-center gap-2 px-1">
        <Link href="/admin" className={small}>
          ← Admin
        </Link>
        <h1 className="mr-auto text-xl font-bold">সেমিস্টার</h1>
        <ThemeToggle />
      </header>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          className={primary}
          onClick={() => setDialog({ kind: 'start', preselect: [] })}
        >
          + সেমিস্টার চালু করুন
        </button>
        <button type="button" className={small} onClick={() => setDialog({ kind: 'checkpoint' })}>
          সবার অবস্থা মিলিয়ে দিন (চেকপয়েন্ট)
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          বিভাগ
          <select
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={deptCode}
            onChange={(e) => setDeptCode(e.target.value)}
          >
            <option value="">সব</option>
            {structure?.departments.map((d) => (
              <option key={d.id} value={d.code}>
                {d.code}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" className="px-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {!structure || !list ? (
        <p className="px-1 text-sm">লোড হচ্ছে…</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map(({ s, name }) => {
            const sem = active.get(s.id);
            const e = entries.get(s.id);
            const ended = e?.state.phase === 'AWAITING_NEXT';
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5 text-sm">
                <span className="w-16 font-semibold">{name}</span>
                {sem && e ? (
                  <>
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${PHASE_STYLE[e.state.phase].badge}`}
                    >
                      {PHASE_BN[e.state.phase]}
                    </span>
                    <span className="min-w-0 flex-1">
                      {stateLineBn(e.state)}
                      <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                        {sem.label ? `${sem.label} · ` : ''}শুরু {bnDate(sem.startDate, true)}
                        {nextLineBn(e.state) && ` · পরবর্তী ${nextLineBn(e.state)}`}
                      </span>
                      {ended && (
                        <span className="block text-xs font-medium text-amber-700 dark:text-amber-400">
                          সেমিস্টার শেষ — পরের সেমিস্টার শুরুর তারিখ দিন
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={small}
                      onClick={() =>
                        setDialog({ kind: 'detail', semesterId: sem.id, seriesId: s.id, name })
                      }
                    >
                      খুলুন
                    </button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-400">
                      — কোনো সক্রিয় সেমিস্টার নেই
                    </span>
                    <button
                      type="button"
                      className={small}
                      onClick={() => setDialog({ kind: 'start', preselect: [s.id] })}
                    >
                      চালু করুন
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === 'start' && structure && (
        <BulkStart
          structure={structure}
          freeIds={new Set(free.map((s) => s.id))}
          preselect={dialog.preselect}
          today={today}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === 'checkpoint' && structure && (
        <BulkCheckpoint
          structure={structure}
          active={active}
          today={today}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.kind === 'detail' && (
        <SemesterDetail
          semesterId={dialog.semesterId}
          seriesId={dialog.seriesId}
          name={dialog.name}
          today={today}
          onClose={() => setDialog(null)}
          onChanged={reload}
        />
      )}
    </main>
  );
}

// --- Start semesters for many series at once -------------------------------------------------------

function phaseOptions(template: Template) {
  return ([...new Set(template.map((p) => p.phase))] as Phase[]).map((phase) => ({
    phase,
    weeks: template.filter((p) => p.phase === phase).reduce((n, p) => n + p.weeks, 0),
  }));
}

function BulkStart({
  structure,
  freeIds,
  preselect,
  today,
  onClose,
  onDone,
}: {
  structure: ApiStructure;
  freeIds: Set<number>;
  preselect: number[];
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState(
    () => new Set(preselect.filter((id) => freeIds.has(id))),
  );
  const [running, setRunning] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [phase, setPhase] = useState<Phase>('CLASS');
  const [week, setWeek] = useState(1);
  const [label, setLabel] = useState('');
  const [template, setTemplate] = useState<Template>(DEFAULT_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = phaseOptions(template);
  const maxWeek = options.find((o) => o.phase === phase)?.weeks ?? 1;
  const choosable = useMemo(
    () => ({ ...structure, series: structure.series.filter((s) => freeIds.has(s.id)) }),
    [structure, freeIds],
  );

  async function submit() {
    setError(null);
    if (selected.size === 0) return setError('অন্তত একটি সিরিজ বেছে নিন।');
    setBusy(true);
    const started = await api<{ semesterIds: number[] }>('/api/admin/semesters/bulk', {
      method: 'POST',
      body: {
        seriesIds: [...selected],
        // Already running: the semester is anchored on the checkpoint date.
        startDate: running ? asOf : startDate,
        label: label.trim() || null,
        template,
      },
    });
    if (!started.ok) {
      setBusy(false);
      return setError(started.message);
    }
    if (running) {
      const cp = await api('/api/admin/semesters/checkpoints/bulk', {
        method: 'POST',
        body: {
          semesterIds: started.data.semesterIds,
          asOfDate: asOf,
          phase,
          weekIndex: Math.min(Math.max(1, week), maxWeek),
        },
      });
      if (!cp.ok) {
        setBusy(false);
        return setError(
          `সেমিস্টার চালু হয়েছে, কিন্তু অবস্থা বসানো যায়নি (${cp.message}). “সবার অবস্থা মিলিয়ে দিন” দিয়ে আবার দিন।`,
        );
      }
    }
    setBusy(false);
    onDone(`${bn(started.data.semesterIds.length)}টি সিরিজের সেমিস্টার চালু হয়েছে।`);
  }

  return (
    <Sheet title="সেমিস্টার চালু করুন" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <SeriesSelect structure={choosable} selected={selected} onChange={setSelected} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">কেমন সেমিস্টার?</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              className="mt-1 h-4 w-4 accent-indigo-600"
              checked={!running}
              onChange={() => setRunning(false)}
            />
            <span>নতুন সেমিস্টার — একটি শুরুর তারিখ থেকে</span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              className="mt-1 h-4 w-4 accent-indigo-600"
              checked={running}
              onChange={() => setRunning(true)}
            />
            <span>ইতিমধ্যে চলছে (go-live) — নির্দিষ্ট তারিখে নির্দিষ্ট ধাপ ও সপ্তাহে আছে</span>
          </label>
        </fieldset>

        {running ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 block text-sm font-medium sm:col-span-1">
              এই তারিখ থেকে
              <input
                type="date"
                className={field}
                value={asOf}
                required
                onChange={(e) => setAsOf(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              ধাপ
              <select
                className={field}
                value={phase}
                onChange={(e) => {
                  setPhase(e.target.value as Phase);
                  setWeek(1);
                }}
              >
                {options.map((o) => (
                  <option key={o.phase} value={o.phase}>
                    {PHASE_BN[o.phase]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              সপ্তাহ (১–{bn(maxWeek)})
              <input
                type="number"
                min={1}
                max={maxWeek}
                className={field}
                value={week}
                onChange={(e) => setWeek(Number(e.target.value) || 1)}
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm font-medium">
            শুরুর তারিখ
            <input
              type="date"
              className={field}
              value={startDate}
              required
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
        )}

        <label className="block text-sm font-medium">
          সেমিস্টারের নাম <span className="font-normal text-zinc-500">(ঐচ্ছিক, যেমন 2-2)</span>
          <input
            className={field}
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>

        <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium">
            ধাপের তালিকা বদলাবেন? (সাধারণত দরকার নেই)
          </summary>
          <div className="mt-3">
            <TemplateEditor value={template} onChange={setTemplate} />
          </div>
        </details>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button disabled={busy || selected.size === 0} className={primary}>
            {busy ? 'চালু হচ্ছে…' : `${bn(selected.size)}টি সিরিজ চালু করুন`}
          </button>
          <button type="button" className={small} onClick={onClose} disabled={busy}>
            বাতিল
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// --- "They are all in week X now" for many semesters ---------------------------------------------

function BulkCheckpoint({
  structure,
  active,
  today,
  onClose,
  onDone,
}: {
  structure: ApiStructure;
  active: Map<number, AdminSemester>;
  today: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [asOf, setAsOf] = useState(today);
  const [phase, setPhase] = useState<Phase>('CLASS');
  const [week, setWeek] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choosable = useMemo(
    () => ({ ...structure, series: structure.series.filter((s) => active.has(s.id)) }),
    [structure, active],
  );
  // Phases every selected semester has (they normally share the default template).
  const chosen = [...selected].map((id) => active.get(id)!).filter(Boolean);
  const common = phaseOptions(chosen[0]?.template ?? DEFAULT_TEMPLATE).filter((o) =>
    chosen.every((s) => s.template.some((p) => p.phase === o.phase)),
  );
  const maxWeek = common.find((o) => o.phase === phase)?.weeks ?? 1;

  async function submit() {
    setError(null);
    setBusy(true);
    const r = await api('/api/admin/semesters/checkpoints/bulk', {
      method: 'POST',
      body: {
        semesterIds: chosen.map((s) => s.id),
        asOfDate: asOf,
        phase,
        weekIndex: Math.min(Math.max(1, week), maxWeek),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone(`${bn(chosen.length)}টি সেমিস্টারের অবস্থা মিলিয়ে দেওয়া হয়েছে।`);
  }

  return (
    <Sheet title="সবার অবস্থা মিলিয়ে দিন" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          “এই তারিখ থেকে এরা সবাই অমুক ধাপের অমুক সপ্তাহে আছে” — বাকি সময়সূচি এখান থেকে নতুন করে
          হিসাব হবে। শুধু চালু থাকা সেমিস্টার দেখানো হচ্ছে।
        </p>
        <SeriesSelect structure={choosable} selected={selected} onChange={setSelected} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="col-span-2 block text-sm font-medium sm:col-span-1">
            এই তারিখ থেকে
            <input
              type="date"
              className={field}
              value={asOf}
              required
              onChange={(e) => setAsOf(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            ধাপ
            <select
              className={field}
              value={phase}
              onChange={(e) => {
                setPhase(e.target.value as Phase);
                setWeek(1);
              }}
            >
              {common.map((o) => (
                <option key={o.phase} value={o.phase}>
                  {PHASE_BN[o.phase]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            সপ্তাহ (১–{bn(maxWeek)})
            <input
              type="number"
              min={1}
              max={maxWeek}
              className={field}
              value={week}
              onChange={(e) => setWeek(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <button disabled={busy || chosen.length === 0} className={primary}>
            {busy ? 'সংরক্ষণ হচ্ছে…' : `${bn(chosen.length)}টি সেমিস্টারে বসান`}
          </button>
          <button type="button" className={small} onClick={onClose} disabled={busy}>
            বাতিল
          </button>
        </div>
      </form>
    </Sheet>
  );
}
