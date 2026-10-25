'use client';
import { useCallback, useEffect, useState } from 'react';
import { milestones } from '@/core/semester/impact';
import type { Phase, Template } from '@/core/semester/timeline';
import { api, type AuditEntry } from '@/lib/api';
import { stamp } from '@/lib/format';
import { bn } from '@/lib/rule-summary';
import {
  bnDate,
  delayLineBn,
  nextLineBn,
  PHASE_BN,
  PHASE_STYLE,
  stateLineBn,
  type AdminSemester,
  type TimelineResponse,
  type TimelineWeek,
} from '@/lib/semester-ui';
import { Sheet } from './Sheet';
import { TemplateEditor } from './TemplateEditor';
import { Legend, TimelineStrip } from './TimelineStrip';
import { useToast } from './Toast';
import { field, primary, small } from './ui';

type PinPhase = 'MID_BREAK' | 'VIVA' | 'FINALS';

/** One series' semester: timeline, week overrides, pins, checkpoints, template, complete, delete. */
export function SemesterDetail({
  semesterId,
  seriesId,
  name,
  today,
  onClose,
  onChanged,
}: {
  semesterId: number;
  seriesId: number;
  name: string;
  today: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const [record, setRecord] = useState<AdminSemester | null>(null);
  const [tl, setTl] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TimelineWeek | null>(null);
  const [confirm, setConfirm] = useState<'complete' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ semesters: AdminSemester[] }>(`/api/admin/semesters?seriesId=${seriesId}`),
      api<TimelineResponse>(`/api/semesters/${semesterId}/timeline?date=${today}&t=${Date.now()}`),
    ]).then(([a, t]) => {
      if (!live) return;
      if (!a.ok || !t.ok) return setError(a.ok ? (t.ok ? '' : t.message) : a.message);
      setRecord(a.data.semesters.find((s) => s.id === semesterId) ?? null);
      setTl(t.data);
    });
    return () => {
      live = false;
    };
  }, [semesterId, seriesId, today, version]);

  /** One write; refreshes this sheet and the list behind it. */
  const act = useCallback(
    async (method: string, path: string, body: unknown, message: string) => {
      setBusy(true);
      const r = await api(path, { method, body });
      setBusy(false);
      if (!r.ok) {
        toast(
          r.status === 401 ? 'Your session expired. Please sign in again.' : r.message,
          'error',
        );
        return false;
      }
      toast(message);
      setVersion((v) => v + 1);
      onChanged();
      return true;
    },
    [toast, onChanged],
  );

  const base = `/api/admin/semesters/${semesterId}`;
  const frozen = record?.status === 'COMPLETED';

  return (
    <Sheet title={`${name} · সেমিস্টার`} onClose={onClose}>
      {error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      ) : !record || !tl ? (
        <p className="text-sm">লোড হচ্ছে…</p>
      ) : (
        <div className="space-y-6">
          <section aria-label="এখনকার অবস্থা" className="space-y-1">
            <p className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-sm font-medium ${PHASE_STYLE[tl.state.phase].badge}`}
              >
                {PHASE_BN[tl.state.phase]}
              </span>
              <span className="text-sm">{stateLineBn(tl.state)}</span>
              {record.label && <span className="text-xs text-zinc-500">({record.label})</span>}
            </p>
            {nextLineBn(tl.state) && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                পরবর্তী: {nextLineBn(tl.state)}
              </p>
            )}
            {tl.state.reasons.length > 0 && (
              <ul className="text-sm text-amber-800 dark:text-amber-300">
                {tl.state.reasons.map((g) => (
                  <li key={g.from}>ⓘ {delayLineBn(g)}</li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="d-strip" className="space-y-2">
            <h3 id="d-strip" className="text-sm font-semibold">
              সময়রেখা{' '}
              <span className="font-normal text-zinc-500">
                · {bnDate(tl.startDate, true)} – {bnDate(tl.endDate, true)}
              </span>
            </h3>
            <TimelineStrip
              weeks={tl.weeks}
              today={today}
              onPick={frozen ? undefined : setPicked}
              selected={picked?.weekStart}
            />
            <Legend />
            {picked && record && (
              <WeekPanel
                week={picked}
                override={record.weekOverrides.find((o) => o.weekStart === picked.weekStart)}
                busy={busy}
                onSet={(mode) =>
                  act(
                    'PUT',
                    `${base}/week-overrides`,
                    { weekStart: picked.weekStart, mode },
                    'সপ্তাহ সংরক্ষিত।',
                  )
                }
                onClear={() =>
                  act(
                    'DELETE',
                    `${base}/week-overrides`,
                    { weekStart: picked.weekStart },
                    'ওভাররাইড সরানো হয়েছে।',
                  )
                }
              />
            )}
            {!frozen && !picked && (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                কোনো সপ্তাহে ট্যাপ করে সেটি জোর করে বাড়ানো বা না-বাড়ানো ঠিক করুন।
              </p>
            )}
            {record.weekOverrides.length > 0 && (
              <ul className="space-y-1 text-sm">
                {record.weekOverrides.map((o) => (
                  <li key={o.weekStart} className="flex items-center gap-2">
                    <span>
                      {bnDate(o.weekStart, true)} —{' '}
                      {o.mode === 'FORCE_EXTEND' ? 'জোর করে বাড়ানো' : 'ছুটি হলেও গণনা'}
                    </span>
                    <button
                      type="button"
                      className={small}
                      disabled={busy}
                      onClick={() =>
                        act(
                          'DELETE',
                          `${base}/week-overrides`,
                          { weekStart: o.weekStart },
                          'সরানো হয়েছে।',
                        )
                      }
                    >
                      সরান
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!frozen && (
            <>
              <Pins record={record} tl={tl} busy={busy} base={base} act={act} />
              <Checkpoints
                record={record}
                busy={busy}
                semesterId={semesterId}
                today={today}
                act={act}
              />
              <Edit
                record={record}
                busy={busy}
                onSave={(b) => act('PATCH', base, b, 'সংরক্ষিত।')}
              />
            </>
          )}

          <section aria-labelledby="d-end" className="space-y-2">
            <h3 id="d-end" className="text-sm font-semibold">
              সমাপ্তি
            </h3>
            {confirm ? (
              <div className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
                <p className="text-sm">
                  {confirm === 'complete'
                    ? `${name}-এর সেমিস্টার সম্পন্ন করবেন? এরপর নতুন সেমিস্টার চালু করা যাবে।`
                    : `${name}-এর সেমিস্টার মুছে ফেলবেন? (ইতিহাসে থাকবে)`}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={`${small} border-red-700 bg-red-700 text-white hover:bg-red-800`}
                    onClick={async () => {
                      const ok =
                        confirm === 'complete'
                          ? await act('POST', `${base}/complete`, {}, 'সেমিস্টার সম্পন্ন।')
                          : await act('DELETE', base, {}, 'সেমিস্টার মুছে ফেলা হয়েছে।');
                      if (ok) onClose();
                      else setConfirm(null);
                    }}
                  >
                    হ্যাঁ
                  </button>
                  <button type="button" className={small} onClick={() => setConfirm(null)}>
                    না
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {!frozen && (
                  <button type="button" className={small} onClick={() => setConfirm('complete')}>
                    সম্পন্ন করুন
                  </button>
                )}
                <button type="button" className={small} onClick={() => setConfirm('delete')}>
                  মুছুন
                </button>
              </div>
            )}
          </section>

          <History semesterId={semesterId} version={version} />
        </div>
      )}
    </Sheet>
  );
}

type Act = (method: string, path: string, body: unknown, message: string) => Promise<boolean>;

function WeekPanel({
  week,
  override,
  busy,
  onSet,
  onClear,
}: {
  week: TimelineWeek;
  override: AdminSemester['weekOverrides'][number] | undefined;
  busy: boolean;
  onSet: (mode: 'FORCE_EXTEND' | 'NO_EXTEND') => void;
  onClear: () => void;
}) {
  const skipped = week.status !== 'COUNTED';
  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <p className="font-medium">
        {bnDate(week.weekStart, true)}-এর সপ্তাহ ·{' '}
        {skipped
          ? 'গণনা হয়নি'
          : `${PHASE_BN[week.phase]}${week.phaseWeekIndex ? ` সপ্তাহ ${bn(week.phaseWeekIndex)}` : ''}`}
      </p>
      {week.reason && <p className="text-zinc-600 dark:text-zinc-400">{week.reason}</p>}
      <div className="flex flex-wrap gap-2">
        {!skipped && (
          <button
            type="button"
            className={small}
            disabled={busy}
            onClick={() => onSet('FORCE_EXTEND')}
          >
            জোর করে বাড়ান (সপ্তাহটি গণনা নয়)
          </button>
        )}
        {skipped && week.status === 'HOLIDAY_SKIPPED' && (
          <button
            type="button"
            className={small}
            disabled={busy}
            onClick={() => onSet('NO_EXTEND')}
          >
            ছুটি হলেও গণনা করুন
          </button>
        )}
        {override && (
          <button type="button" className={small} disabled={busy} onClick={onClear}>
            ওভাররাইড সরান
          </button>
        )}
      </div>
    </div>
  );
}

function Pins({
  record,
  tl,
  busy,
  base,
  act,
}: {
  record: AdminSemester;
  tl: TimelineResponse;
  busy: boolean;
  base: string;
  act: Act;
}) {
  // A pin on the first block would only repeat the start date, so it is not offered.
  const phases = (['MID_BREAK', 'VIVA', 'FINALS'] as PinPhase[]).filter((p) =>
    record.template.some((x, i) => i > 0 && x.phase === p),
  );
  const startOf = (phase: Phase) => milestones(tl).find((m) => m.phase === phase)?.date ?? '';
  return (
    <section aria-labelledby="d-pins" className="space-y-2">
      <h3 id="d-pins" className="text-sm font-semibold">
        নির্দিষ্ট তারিখে ধাপ শুরু (পিন)
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        পিন করা তারিখেই ধাপটি শুরু হবে, হিসাব যাই বলুক। সেদিনের সপ্তাহ ছুটি হলেও গণনা হবে।
      </p>
      {phases.map((p) => (
        <PinRow
          key={p}
          phase={p}
          pin={record.pins.find((x) => x.phase === p)?.startDate}
          computed={startOf(p)}
          busy={busy}
          onSet={(d) => act('PUT', `${base}/pins`, { phase: p, startDate: d }, 'পিন বসানো হয়েছে।')}
          onClear={() => act('DELETE', `${base}/pins`, { phase: p }, 'পিন সরানো হয়েছে।')}
        />
      ))}
    </section>
  );
}

function PinRow({
  phase,
  pin,
  computed,
  busy,
  onSet,
  onClear,
}: {
  phase: Phase;
  pin: string | undefined;
  computed: string;
  busy: boolean;
  onSet: (d: string) => void;
  onClear: () => void;
}) {
  const [date, setDate] = useState(pin ?? computed);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="block text-xs font-medium">
        {PHASE_BN[phase]} শুরু
        <input
          type="date"
          className={field}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <button
        type="button"
        className={small}
        disabled={busy || !date || date === pin}
        onClick={() => onSet(date)}
      >
        পিন করুন
      </button>
      {pin && (
        <button type="button" className={small} disabled={busy} onClick={onClear}>
          পিন সরান
        </button>
      )}
    </div>
  );
}

function Checkpoints({
  record,
  busy,
  semesterId,
  today,
  act,
}: {
  record: AdminSemester;
  busy: boolean;
  semesterId: number;
  today: string;
  act: Act;
}) {
  const options = ([...new Set(record.template.map((p) => p.phase))] as Phase[]).map((phase) => ({
    phase,
    weeks: record.template.filter((p) => p.phase === phase).reduce((n, p) => n + p.weeks, 0),
  }));
  const [asOf, setAsOf] = useState(today);
  const [phase, setPhase] = useState<Phase>(options[0]!.phase);
  const [week, setWeek] = useState(1);
  const max = options.find((o) => o.phase === phase)?.weeks ?? 1;
  return (
    <section aria-labelledby="d-cp" className="space-y-2">
      <h3 id="d-cp" className="text-sm font-semibold">
        চেকপয়েন্ট (বাস্তবের সাথে মিলিয়ে নিন)
      </h3>
      {record.checkpoints.length > 0 && (
        <ul className="space-y-1 text-sm">
          {record.checkpoints.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2">
              <span>
                {bnDate(c.asOfDate, true)} থেকে {PHASE_BN[c.phase]} সপ্তাহ {bn(c.weekIndex)}
              </span>
              <button
                type="button"
                className={small}
                disabled={busy}
                onClick={() =>
                  act(
                    'DELETE',
                    `/api/admin/semesters/checkpoints/${c.id}`,
                    {},
                    'চেকপয়েন্ট সরানো হয়েছে।',
                  )
                }
              >
                সরান
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            'POST',
            '/api/admin/semesters/checkpoints/bulk',
            {
              semesterIds: [semesterId],
              asOfDate: asOf,
              phase,
              weekIndex: Math.min(Math.max(1, week), max),
            },
            'চেকপয়েন্ট যোগ হয়েছে।',
          );
        }}
      >
        <label className="col-span-2 block text-xs font-medium sm:col-span-1">
          এই তারিখ থেকে
          <input
            type="date"
            className={field}
            value={asOf}
            required
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium">
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
        <label className="block text-xs font-medium">
          সপ্তাহ (১–{bn(max)})
          <input
            type="number"
            min={1}
            max={max}
            className={field}
            value={week}
            onChange={(e) => setWeek(Number(e.target.value) || 1)}
          />
        </label>
        <button className={small} disabled={busy}>
          যোগ করুন
        </button>
      </form>
    </section>
  );
}

function Edit({
  record,
  busy,
  onSave,
}: {
  record: AdminSemester;
  busy: boolean;
  onSave: (body: { label: string | null; startDate: string; template: Template }) => void;
}) {
  const [label, setLabel] = useState(record.label ?? '');
  const [startDate, setStartDate] = useState(record.startDate);
  const [template, setTemplate] = useState<Template>(record.template);
  return (
    <section aria-labelledby="d-edit" className="space-y-3">
      <h3 id="d-edit" className="text-sm font-semibold">
        নাম, শুরুর তারিখ ও ধাপ বদলান
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs font-medium">
          নাম
          <input
            className={field}
            value={label}
            maxLength={30}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="block text-xs font-medium">
          শুরুর তারিখ
          <input
            type="date"
            className={field}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
      </div>
      <TemplateEditor value={template} onChange={setTemplate} />
      <button
        type="button"
        className={primary}
        disabled={busy || !startDate}
        onClick={() => onSave({ label: label.trim() || null, startDate, template })}
      >
        সংরক্ষণ
      </button>
    </section>
  );
}

function describe(e: AuditEntry): string {
  const a = (e.after ?? {}) as Record<string, string | number | undefined>;
  const b = (e.before ?? {}) as Record<string, string | number | undefined>;
  switch (e.entityType) {
    case 'SEMESTER':
      if (e.action === 'CREATE') return `চালু হয়েছে (শুরু ${a.startDate})`;
      if (e.action === 'DELETE') return 'মুছে ফেলা হয়েছে';
      return a.status !== b.status ? 'সম্পন্ন করা হয়েছে' : 'নাম / তারিখ / ধাপ বদলানো হয়েছে';
    case 'SEMESTER_CHECKPOINT':
      return e.action === 'DELETE'
        ? 'চেকপয়েন্ট সরানো হয়েছে'
        : `চেকপয়েন্ট: ${a.asOfDate} থেকে ${PHASE_BN[a.phase as Phase] ?? a.phase} সপ্তাহ ${a.weekIndex}`;
    case 'SEMESTER_WEEK_OVERRIDE':
      return e.action === 'DELETE'
        ? 'সপ্তাহের ওভাররাইড সরানো হয়েছে'
        : `সপ্তাহ ${a.weekStart}: ${a.mode === 'FORCE_EXTEND' ? 'জোর করে বাড়ানো' : 'ছুটি হলেও গণনা'}`;
    case 'SEMESTER_PIN':
      return e.action === 'DELETE'
        ? 'পিন সরানো হয়েছে'
        : `পিন: ${PHASE_BN[a.phase as Phase] ?? a.phase} শুরু ${a.startDate}`;
    default:
      return e.action;
  }
}

function History({ semesterId, version }: { semesterId: number; version: number }) {
  const [res, setRes] = useState<{ entries?: AuditEntry[]; error?: string } | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>(`/api/admin/audit?semesterId=${semesterId}`).then((r) =>
      setRes(r.ok ? { entries: r.data.entries } : { error: r.message }),
    );
  }, [semesterId, version]);
  return (
    <section aria-labelledby="d-hist">
      <details>
        <summary id="d-hist" className="cursor-pointer text-sm font-semibold">
          ইতিহাস
        </summary>
        {!res ? (
          <p className="mt-2 text-sm">লোড হচ্ছে…</p>
        ) : res.error ? (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {res.error}
          </p>
        ) : (
          <ol className="mt-2 space-y-2">
            {res.entries!.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
              >
                <p className="font-medium">{describe(e)}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {e.admin.name} · {stamp(e.at)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}
