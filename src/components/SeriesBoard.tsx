'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import {
  buildSlots,
  DEFAULT_STRUCTURE,
  J_PHASES,
  SEMESTERS,
  type JPhase,
  type JourneyStructure,
} from '@/core/journey/journey';
import { fieldsFromStructure, type ScheduleFields } from '@/core/journey/schedule';
import { api, type ApiStructure } from '@/lib/api';
import { useStatus, useStructure } from '@/lib/hooks';
import {
  dayText,
  headline,
  PHASE_LABEL,
  semLabel,
  type JourneyResponse,
  type StatusEntry,
} from '@/lib/journey-ui';
import { ScheduleForm } from './ScheduleForm';
import { Sheet } from './Sheet';
import { StatusMatrix } from './StatusMatrix';
import { useToast } from './Toast';
import { primary, small } from './ui';

type Target = { kind: 'series'; entry: StatusEntry } | { kind: 'intake'; year: number };

/** Series Board: the public matrix; tap a cell or an intake column to say where it is now. */
export function SeriesBoard() {
  const params = useSearchParams();
  const { structure, failed } = useStructure();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useStatus(todayInDhaka(), { bust: true, version });
  const [target, setTarget] = useState<Target | null>(null);
  const highlight = useMemo(
    () =>
      new Set(
        (params.get('highlight') ?? '')
          .split(',')
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    [params],
  );
  const [settings, setSettings] = useState<JourneyStructure>(DEFAULT_STRUCTURE);
  const bySeries = useMemo(() => new Map(data?.series.map((s) => [s.seriesId, s])), [data]);

  useEffect(() => {
    api<{ structure: JourneyStructure }>('/api/admin/academic-settings').then((r) => {
      if (r.ok) setSettings(r.data.structure);
    });
  }, []);

  if (error || failed) {
    return (
      <p role="alert" className="px-1 text-sm text-red-700 dark:text-red-400">
        Could not load the board.{' '}
        <button type="button" className="underline" onClick={() => setVersion((v) => v + 1)}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
        Tap a box to say where that series is now. Tap a column header (21 ▾) to set a whole batch
        at once.
        {highlight.size > 0 && ' Highlighted boxes still need a status.'}
      </p>
      {structure ? (
        <StatusMatrix
          structure={structure}
          bySeries={bySeries}
          loading={loading}
          onCell={(entry) => setTarget({ kind: 'series', entry })}
          onColumn={(year) => setTarget({ kind: 'intake', year })}
          highlight={highlight}
        />
      ) : (
        <p className="px-1 text-sm">Loading…</p>
      )}
      {target && structure && (
        <WhereSheet
          key={target.kind === 'series' ? target.entry.seriesId : `y${target.year}`}
          structure={structure}
          settings={settings}
          bySeries={bySeries}
          target={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

const chipOn = 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950';

/** "Where is CSE-23 now?": semester, stage, week, one step at a time, pre-filled; no typing. */
function WhereSheet({
  structure,
  settings,
  bySeries,
  target,
  onClose,
  onSaved,
}: {
  structure: ApiStructure;
  settings: JourneyStructure;
  bySeries: Map<number, StatusEntry>;
  target: Target;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const today = useMemo(() => todayInDhaka(), []);
  const now = target.kind === 'series' ? target.entry.state : null;
  const running = now?.status === 'RUNNING';
  const [sem, setSem] = useState<number | null>(running ? now.semesterNo : null);
  const [phase, setPhase] = useState<JPhase | null>(running ? now.phase : null);
  const [week, setWeek] = useState<number | null>(running ? now.weekNo : null);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState(false);

  const all = useMemo(
    () =>
      target.kind === 'series'
        ? [target.entry]
        : structure.series
            .filter((s) => s.intakeYear === target.year)
            .flatMap((s) => bySeries.get(s.id) ?? []),
    [target, structure, bySeries],
  );
  // Whole-batch sheet: every department is on; "Except" switches off the ones that are elsewhere.
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = all.filter((e) => !off.has(e.seriesId));

  const weeksOf = (p: JPhase) => buildSlots(settings).filter((s) => s.phase === p).length;
  const maxWeek = phase ? weeksOf(phase) : 0;
  const weekNo = phase && maxWeek === 1 ? 1 : week;
  const needsWeek = phase !== null && maxWeek > 1;
  const steps = ['semester', 'stage', ...(needsWeek ? ['week'] : [])] as const;
  const last = step >= steps.length - 1;
  const ready = sem !== null && phase !== null && weekNo !== null && chosen.length > 0;
  const who = chosen.length === 1 ? chosen[0]!.series : `${chosen.length} series`;
  const title =
    target.kind === 'series'
      ? `Where is ${target.entry.series} now?`
      : `Where is batch ${target.year} now?`;
  const stageText = phase
    ? phase === 'CLASS'
      ? `Class week ${weekNo ?? '?'}`
      : phase === 'EXAM'
        ? `Semester Final week ${weekNo ?? '?'}`
        : PHASE_LABEL[phase]
    : '';

  async function save() {
    if (!ready) return;
    setSaving(true);
    const r = await api('/api/admin/positions/bulk', {
      method: 'POST',
      body: {
        seriesIds: chosen.map((e) => e.seriesId),
        kind: 'POSITION',
        asOfDate: today,
        semesterNo: sem,
        phase,
        weekNo,
      },
    });
    setSaving(false);
    if (!r.ok) return toast(r.message, 'error');
    toast(`Status saved for ${chosen.length} ${chosen.length === 1 ? 'series' : 'series'}.`);
    onSaved();
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-4">
        {target.kind === 'series' && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Now: {headline(target.entry)}</p>
        )}
        <p className="text-xs text-zinc-500">
          Step {step + 1} of {steps.length}
        </p>

        {steps[step] === 'semester' && (
          <Group label="Semester">
            {Array.from({ length: SEMESTERS }, (_, i) => i + 1).map((n) => (
              <Chip key={n} on={sem === n} onClick={() => setSem(n)}>
                {semLabel(n)}
              </Chip>
            ))}
          </Group>
        )}

        {steps[step] === 'stage' && (
          <Group label="Stage">
            {J_PHASES.map((p) => (
              <Chip
                key={p}
                on={phase === p}
                onClick={() => {
                  setPhase(p);
                  if (p !== phase) setWeek(null);
                }}
              >
                {PHASE_LABEL[p]}
              </Chip>
            ))}
          </Group>
        )}

        {steps[step] === 'week' && (
          <Group label="Which week?">
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((n) => (
              <Chip key={n} on={week === n} onClick={() => setWeek(n)}>
                {n}
              </Chip>
            ))}
          </Group>
        )}

        {target.kind === 'intake' && (
          <Group label="Except (tap a department to leave it out; set it separately later)">
            {all.map((e) => (
              <Chip
                key={e.seriesId}
                on={off.has(e.seriesId)}
                onClick={() =>
                  setOff((o) => {
                    const n = new Set(o);
                    if (n.has(e.seriesId)) n.delete(e.seriesId);
                    else n.add(e.seriesId);
                    return n;
                  })
                }
              >
                {e.series.split('-')[0]}
              </Chip>
            ))}
          </Group>
        )}

        {sem !== null && chosen.length > 0 && (
          <button type="button" className="text-sm underline" onClick={() => setSchedule(true)}>
            This semester has a different schedule
          </button>
        )}

        {target.kind === 'series' && (
          <SavedPositions seriesId={target.entry.seriesId} onChanged={onSaved} />
        )}

        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm" aria-live="polite">
            {ready
              ? `From today, ${who} ${chosen.length === 1 ? 'is' : 'are'} in Semester ${semLabel(sem!)}, ${stageText}.`
              : 'Choose the semester, stage and week.'}
          </p>
          <div className="flex gap-2">
            {last ? (
              <button type="button" className={primary} disabled={!ready || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            ) : (
              <button
                type="button"
                className={primary}
                disabled={steps[step] === 'semester' ? sem === null : phase === null}
                onClick={() => setStep(step + 1)}
              >
                Next
              </button>
            )}
            {step > 0 && (
              <button
                type="button"
                className={`${small} px-4 py-2`}
                onClick={() => setStep(step - 1)}
              >
                Back
              </button>
            )}
            <button type="button" className={`${small} px-4 py-2`} onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
      {schedule && sem !== null && (
        <ScheduleSheet
          semesterNo={sem}
          who={who}
          seriesIds={chosen.map((e) => e.seriesId)}
          defaults={fieldsFromStructure(settings)}
          onClose={() => setSchedule(false)}
          onSaved={onSaved}
        />
      )}
    </Sheet>
  );
}

/**
 * One semester with a different schedule (e.g. CME-21 4-2 had its mid-term break after week 8).
 * Pre-filled with what the first chosen series has now; a whole batch starts from the default.
 */
function ScheduleSheet({
  semesterNo,
  who,
  seriesIds,
  defaults,
  onClose,
  onSaved,
}: {
  semesterNo: number;
  who: string;
  seriesIds: number[];
  defaults: ScheduleFields | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const base = defaults ?? fieldsFromStructure(DEFAULT_STRUCTURE)!;
  // A whole batch starts from the default; one series shows what it has now (loaded below).
  const [now, setNow] = useState<{ fields: ScheduleFields; breakStart: string | null } | null>(
    seriesIds.length === 1 ? null : { fields: base, breakStart: null },
  );

  useEffect(() => {
    if (seriesIds.length !== 1) return;
    api<JourneyResponse>(`/api/series/${seriesIds[0]}/journey?_=${Date.now()}`).then((r) => {
      const own = r.ok ? r.data.schedules.find((x) => x.semesterNo === semesterNo)?.fields : null;
      const s = r.ok ? r.data.semesters.find((x) => x.semesterNo === semesterNo) : null;
      setNow({ fields: own ?? base, breakStart: s?.midBreakStart ?? null });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Sheet title={`Semester ${semLabel(semesterNo)} schedule · ${who}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Only this semester changes. The next one goes back to the usual schedule.
        </p>
        {!now ? (
          <p className="text-sm">Loading…</p>
        ) : (
          <ScheduleForm
            initial={now.fields}
            expectedBreak={now.breakStart}
            busy={busy}
            onCancel={onClose}
            onSave={async (fields) => {
              setBusy(true);
              const r = await api('/api/admin/schedules', {
                method: 'POST',
                body: { seriesIds, semesterNo, fields },
              });
              setBusy(false);
              if (!r.ok) return toast(r.message, 'error');
              toast('Schedule saved.');
              onSaved();
            }}
          />
        )}
      </div>
    </Sheet>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`${small} min-w-11 px-3 py-2 ${on ? chipOn : ''}`}
    >
      {children}
    </button>
  );
}

/** The change history of one series' status; a wrong entry can be deleted here (the earliest one is the anchor). */
function SavedPositions({ seriesId, onChanged }: { seriesId: number; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<JourneyResponse['positions'] | null>(null);
  const [schedules, setSchedules] = useState<JourneyResponse['schedules']>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<JourneyResponse>(`/api/series/${seriesId}/journey?_=${Date.now()}`).then((r) => {
      if (!live) return;
      setRows(r.ok ? r.data.positions : []);
      setSchedules(r.ok ? r.data.schedules.filter((x) => x.fields) : []);
    });
    return () => {
      live = false;
    };
  }, [seriesId, version]);

  if (!rows || rows.length + schedules.length === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Change history ({rows.length + schedules.length})
      </summary>
      <ul className="space-y-1 px-3 pb-3 text-sm">
        {schedules.map((x) => (
          <li key={`s${x.semesterNo}`}>
            Semester {semLabel(x.semesterNo)} · different schedule: classes{' '}
            {x.fields!.classesBefore} + {x.fields!.classesAfter}, Board Viva {x.fields!.vivaWeeks},
            Final {x.fields!.finalWeeks}
          </li>
        ))}
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2">
            <span>
              {dayText(p.asOfDate)} · {semLabel(p.semesterNo)} ·{' '}
              {p.kind === 'SEMESTER_START'
                ? 'Semester start day'
                : `${PHASE_LABEL[p.phase]}${p.weekNo > 1 || p.phase === 'CLASS' || p.phase === 'EXAM' ? ` week ${p.weekNo}` : ''}`}
            </span>
            <button
              type="button"
              className="ml-auto text-xs text-red-700 underline dark:text-red-400"
              onClick={async () => {
                const r = await api(`/api/admin/positions/${p.id}`, { method: 'DELETE' });
                if (!r.ok) return toast(r.message, 'error');
                toast('Deleted.');
                setVersion((v) => v + 1);
                onChanged();
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
