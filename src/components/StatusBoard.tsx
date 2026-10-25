'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { isRealDate } from '@/core/validation/holidays-query';
import { api, type ApiStructure } from '@/lib/api';
import { useStructure } from '@/lib/hooks';
import { bn } from '@/lib/rule-summary';
import {
  bnDate,
  delayLineBn,
  nextLineBn,
  PHASE_BN,
  PHASE_STYLE,
  stateLineBn,
  type StatePhase,
  type StatusEntry,
  type StatusResponse,
} from '@/lib/semester-ui';
import { ThemeToggle } from './ThemeToggle';
import { TimelineDrawer } from './TimelineDrawer';
import { TopNav } from './TopNav';

const PHASE_ORDER: StatePhase[] = [
  'CLASS',
  'MID_BREAK',
  'VIVA',
  'FINALS',
  'AWAITING_NEXT',
  'COMPLETED',
  'NOT_STARTED',
];

export function StatusBoard() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = useMemo(() => todayInDhaka(), []);
  const raw = params.get('d');
  const date = raw && isRealDate(raw) ? raw : today;

  const { structure, failed: structureFailed } = useStructure();
  const [res, setRes] = useState<{ date: string; data?: StatusResponse; error?: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api<StatusResponse>(`/api/status?date=${date}`).then((r) => {
      if (live) setRes(r.ok ? { date, data: r.data } : { date, error: r.message });
    });
    return () => {
      live = false;
    };
  }, [date, retry]);

  const setDate = (d: string) => {
    const next = new URLSearchParams(params.toString());
    if (!d || d === today) next.delete('d');
    else next.set('d', d);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const data = res?.date === date ? res.data : undefined;
  const loading = !res || res.date !== date;
  const bySeries = useMemo(() => new Map(data?.series.map((s) => [s.seriesId, s])), [data]);

  return (
    <main className="mx-auto max-w-6xl space-y-3 px-2 py-3 sm:px-4">
      <div className="flex items-center justify-between gap-2 px-1">
        <h1 className="text-xl font-bold sm:text-2xl">RUET সেমিস্টার স্ট্যাটাস</h1>
        <ThemeToggle />
      </div>
      <TopNav />

      <div className="flex flex-wrap items-end gap-2 px-1">
        <label className="text-sm">
          <span className="mb-1 block font-medium">এই তারিখের অবস্থা দেখুন</span>
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {date !== today && (
          <button
            type="button"
            onClick={() => setDate(today)}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            আজ
          </button>
        )}
      </div>

      {res?.error || structureFailed ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
        >
          <p>স্ট্যাটাস লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।</p>
          <button
            type="button"
            className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-medium text-white"
            onClick={() => {
              setRes(null);
              setRetry((n) => n + 1);
            }}
          >
            আবার চেষ্টা করুন
          </button>
        </div>
      ) : (
        <>
          <Summary data={data} date={date} today={today} loading={loading} />
          {structure && (
            <Board
              structure={structure}
              bySeries={bySeries}
              loading={loading}
              onOpen={(e) => setOpen(e.semesterId)}
            />
          )}
          {!structure && <p className="px-1 text-sm">লোড হচ্ছে…</p>}
          {!loading && data && data.series.length === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
              এখনো কোনো সেমিস্টার চালু করা হয়নি।
            </p>
          )}
        </>
      )}

      <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
        ⓘ চিহ্নিত ঘরে ছুটির কারণে সেমিস্টার পিছিয়েছে। বিস্তারিত দেখতে ঘরে ট্যাপ করুন। তারিখ ও
        অবস্থা ছুটির তালিকা বদলালে বদলে যেতে পারে।
      </p>

      {open !== null && (
        <TimelineDrawer semesterId={open} date={date} onClose={() => setOpen(null)} />
      )}
    </main>
  );
}

function Summary({
  data,
  date,
  today,
  loading,
}: {
  data: StatusResponse | undefined;
  date: string;
  today: string;
  loading: boolean;
}) {
  const total = data?.series.length ?? 0;
  return (
    <section
      aria-label="সারসংক্ষেপ"
      aria-live="polite"
      className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <p className="text-sm font-medium">
        {date === today ? 'আজ' : bnDate(date, true)}, রুয়েটে{' '}
        {loading ? '…' : `${bn(total)}টি সিরিজের সেমিস্টার চলছে বা শেষ হয়েছে`}
      </p>
      {!loading && data && total > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2 text-sm">
          {PHASE_ORDER.filter((p) => data.summary[p]).map((p) => (
            <li key={p} className={`rounded px-2 py-0.5 font-medium ${PHASE_STYLE[p].badge}`}>
              {PHASE_BN[p]} {bn(data.summary[p]!)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Board({
  structure,
  bySeries,
  loading,
  onOpen,
}: {
  structure: ApiStructure;
  bySeries: Map<number, StatusEntry>;
  loading: boolean;
  onOpen: (e: StatusEntry) => void;
}) {
  const years = [...new Set(structure.series.map((s) => s.intakeYear))].sort((a, b) => b - a);
  const groups = structure.faculties
    .map((f) => ({
      f,
      depts: structure.departments.filter((d) => d.facultyId === f.id),
    }))
    .filter((g) => g.depts.length > 0);
  const seriesOf = (deptId: number, year: number) =>
    structure.series.find((s) => s.departmentId === deptId && s.intakeYear === year);

  return (
    <>
      {/* Wide screens: departments down, intake years across. */}
      <div className="hidden overflow-x-auto lg:block" aria-busy={loading}>
        <table className="w-full table-fixed border-separate border-spacing-1 text-left">
          <caption className="sr-only">বিভাগ ও ভর্তির বছর অনুযায়ী সেমিস্টারের অবস্থা</caption>
          <thead>
            <tr>
              <th scope="col" className="w-20 px-1 text-xs font-medium text-zinc-500">
                বিভাগ
              </th>
              {years.map((y) => (
                <th key={y} scope="col" className="px-1 text-xs font-medium text-zinc-500">
                  {y} সিরিজ
                </th>
              ))}
            </tr>
          </thead>
          {groups.map(({ f, depts }) => (
            <tbody key={f.id}>
              <tr>
                <th
                  colSpan={years.length + 1}
                  scope="colgroup"
                  className="px-1 pt-3 text-sm font-semibold"
                >
                  {f.code} Faculty <span className="font-normal text-zinc-500">· {f.name}</span>
                </th>
              </tr>
              {depts.map((d) => (
                <tr key={d.id}>
                  <th scope="row" className="px-1 align-top text-sm font-medium">
                    {d.code}
                  </th>
                  {years.map((y) => {
                    const s = seriesOf(d.id, y);
                    const e = s && bySeries.get(s.id);
                    return (
                      <td key={y} className="align-top">
                        <Cell
                          entry={e}
                          loading={loading}
                          onOpen={onOpen}
                          name={`${d.code}-${String(y % 100).padStart(2, '0')}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {/* Phones and tablets: one card per department, its series listed inside. */}
      <div className="space-y-4 lg:hidden" aria-busy={loading}>
        {groups.map(({ f, depts }) => (
          <section key={f.id} aria-label={`${f.code} Faculty`} className="space-y-2">
            <h2 className="px-1 text-sm font-semibold">
              {f.code} Faculty <span className="font-normal text-zinc-500">· {f.name}</span>
            </h2>
            {depts.map((d) => {
              const list = years
                .map((y) => seriesOf(d.id, y))
                .filter((s): s is NonNullable<typeof s> => !!s);
              return (
                <article
                  key={d.id}
                  className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <h3 className="mb-1 px-1 text-sm font-medium">{d.code}</h3>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {list.map((s) => {
                      const e = bySeries.get(s.id);
                      const name = `${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}`;
                      return (
                        <li key={s.id}>
                          <p className="px-1 text-xs text-zinc-500">{s.intakeYear} সিরিজ</p>
                          <Cell entry={e} loading={loading} onOpen={onOpen} name={name} />
                        </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </>
  );
}

function Cell({
  entry,
  loading,
  onOpen,
  name,
}: {
  entry: StatusEntry | undefined;
  loading: boolean;
  onOpen: (e: StatusEntry) => void;
  name: string;
}) {
  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />;
  }
  if (!entry) {
    return (
      <div
        className="rounded-md border border-dashed border-zinc-300 px-2 py-3 text-center text-zinc-500 dark:border-zinc-700"
        aria-label={`${name}: কোনো সক্রিয় সেমিস্টার নেই`}
      >
        —
      </div>
    );
  }
  const s = entry.state;
  const next = nextLineBn(s);
  const delayed = s.delayedWeeks > 0 && s.phase !== 'COMPLETED';
  const describe = [
    `${name}: ${stateLineBn(s)}`,
    next && `পরবর্তী ${next}`,
    delayed && s.reasons.map(delayLineBn).join('; '),
  ]
    .filter(Boolean)
    .join('. ');
  return (
    <button
      type="button"
      onClick={() => onOpen(entry)}
      aria-label={`${describe}. সময়রেখা দেখুন`}
      className="block w-full rounded-md border border-zinc-200 bg-white p-2 text-left hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <span className="flex items-center justify-between gap-1">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PHASE_STYLE[s.phase].badge}`}>
          {PHASE_BN[s.phase]}
        </span>
        {delayed && (
          <span
            className="text-sm text-amber-700 dark:text-amber-400"
            title={s.reasons.map(delayLineBn).join('\n')}
            aria-hidden
          >
            ⓘ
          </span>
        )}
      </span>
      <span className="mt-1 block text-xs">{stateLineBn(s)}</span>
      <span
        className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(s.progress * 100)}
        aria-label="অগ্রগতি"
      >
        <span
          className={`block h-full ${PHASE_STYLE[s.phase].bar}`}
          style={{ width: `${Math.round(s.progress * 100)}%` }}
        />
      </span>
      {next && (
        <span className="mt-1 block text-[11px] text-zinc-600 dark:text-zinc-400">
          পরবর্তী: {next}
        </span>
      )}
    </button>
  );
}
