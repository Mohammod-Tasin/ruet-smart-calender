'use client';
import { useEffect, useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import {
  bnDigits,
  buildSlots,
  DEFAULT_STRUCTURE,
  J_PHASES,
  SEMESTERS,
  type JPhase,
  type JourneyStructure,
} from '@/core/journey/journey';
import { api, type ApiStructure } from '@/lib/api';
import { useStatus, useStructure } from '@/lib/hooks';
import {
  bnDate,
  headline,
  PHASE_BN,
  semLabel,
  seriesName,
  type JourneyResponse,
  type StatusEntry,
} from '@/lib/journey-ui';
import { Sheet } from './Sheet';
import { StatusMatrix } from './StatusMatrix';
import { useToast } from './Toast';
import { primary, small } from './ui';

type Target = { kind: 'series'; entry: StatusEntry } | { kind: 'intake'; year: number };

/** সিরিজ বোর্ড: the public matrix; tap a cell or an intake column to say where it is now. */
export function SeriesBoard() {
  const { structure, failed } = useStructure();
  const [version, setVersion] = useState(0);
  const { data, error, loading } = useStatus(todayInDhaka(), { bust: true, version });
  const [target, setTarget] = useState<Target | null>(null);
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
        বোর্ড লোড করা যায়নি।{' '}
        <button type="button" className="underline" onClick={() => setVersion((v) => v + 1)}>
          আবার চেষ্টা করুন
        </button>
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
        ঘরে ট্যাপ করে সেই সিরিজের এখনকার অবস্থা দিন। কলামের মাথায় (২১ ▾) ট্যাপ করলে পুরো সিরিজ
        একসাথে।
      </p>
      {structure ? (
        <StatusMatrix
          structure={structure}
          bySeries={bySeries}
          loading={loading}
          onCell={(entry) => setTarget({ kind: 'series', entry })}
          onColumn={(year) => setTarget({ kind: 'intake', year })}
        />
      ) : (
        <p className="px-1 text-sm">লোড হচ্ছে…</p>
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

/** "এখন কোথায়?": semester, phase and week as chips; no typing. */
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
  const [sem, setSem] = useState<number | null>(null);
  const [phase, setPhase] = useState<JPhase | null>(null);
  const [week, setWeek] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const all = useMemo(
    () =>
      target.kind === 'series'
        ? [target.entry]
        : structure.series
            .filter((s) => s.intakeYear === target.year)
            .flatMap((s) => bySeries.get(s.id) ?? []),
    [target, structure, bySeries],
  );
  // Whole-intake sheet: every department is on; switch off the ones that are somewhere else.
  const [off, setOff] = useState<Set<number>>(new Set());
  const chosen = all.filter((e) => !off.has(e.seriesId));

  const weeksOf = (p: JPhase) => buildSlots(settings).filter((s) => s.phase === p).length;
  const maxWeek = phase ? weeksOf(phase) : 0;
  const weekNo = phase && maxWeek === 1 ? 1 : week;
  const ready = sem !== null && phase !== null && weekNo !== null && chosen.length > 0;
  const title =
    target.kind === 'series'
      ? `${seriesName(target.entry.series)} · এখন কোথায়?`
      : `${bnDigits(target.year)} সিরিজ · এখন কোথায়?`;

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
    toast(`${bnDigits(chosen.length)}টি সিরিজের অবস্থা সংরক্ষণ হয়েছে।`);
    onSaved();
  }

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="space-y-4">
        {target.kind === 'series' && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">এখন: {headline(target.entry)}</p>
        )}

        <Group label="সেমিস্টার">
          {Array.from({ length: SEMESTERS }, (_, i) => i + 1).map((n) => (
            <Chip key={n} on={sem === n} onClick={() => setSem(n)}>
              {semLabel(n)}
            </Chip>
          ))}
        </Group>

        <Group label="ধাপ">
          {J_PHASES.map((p) => (
            <Chip
              key={p}
              on={phase === p}
              onClick={() => {
                setPhase(p);
                setWeek(null);
              }}
            >
              {PHASE_BN[p]}
            </Chip>
          ))}
        </Group>

        {phase && maxWeek > 1 && (
          <Group label="কত নম্বর সপ্তাহ?">
            {Array.from({ length: maxWeek }, (_, i) => i + 1).map((n) => (
              <Chip key={n} on={week === n} onClick={() => setWeek(n)}>
                {bnDigits(n)}
              </Chip>
            ))}
          </Group>
        )}

        {target.kind === 'intake' && (
          <Group label="কোন ডিপার্টমেন্ট? (যাদের অবস্থা আলাদা তাদের বন্ধ করুন, পরে ঘরে ট্যাপ করে আলাদা দিন)">
            {all.map((e) => (
              <Chip
                key={e.seriesId}
                on={!off.has(e.seriesId)}
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

        {target.kind === 'series' && (
          <SavedPositions seriesId={target.entry.seriesId} onChanged={onSaved} />
        )}

        <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm" aria-live="polite">
            {ready
              ? `${chosen.length === 1 ? seriesName(chosen[0]!.series) : `${bnDigits(chosen.length)}টি সিরিজ`} · ${semLabel(sem!)} · ${PHASE_BN[phase!]}${maxWeek > 1 ? ` ${bnDigits(weekNo!)} নম্বর সপ্তাহ` : ''}`
              : 'সেমিস্টার, ধাপ ও সপ্তাহ বেছে নিন।'}
          </p>
          <div className="flex gap-2">
            <button type="button" className={primary} disabled={!ready || saving} onClick={save}>
              {saving ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ'}
            </button>
            <button type="button" className={`${small} px-4 py-2`} onClick={onClose}>
              বাতিল
            </button>
          </div>
        </div>
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

/** The saved entries of one series, so a wrong one can be removed (the earliest one is the anchor). */
function SavedPositions({ seriesId, onChanged }: { seriesId: number; onChanged: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<JourneyResponse['positions'] | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    api<JourneyResponse>(`/api/series/${seriesId}/journey?_=${Date.now()}`).then((r) => {
      if (live) setRows(r.ok ? r.data.positions : []);
    });
    return () => {
      live = false;
    };
  }, [seriesId, version]);

  if (!rows || rows.length === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        সংরক্ষিত তথ্য ({bnDigits(rows.length)})
      </summary>
      <ul className="space-y-1 px-3 pb-3 text-sm">
        {rows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-2">
            <span>
              {bnDate(p.asOfDate, true)} · {semLabel(p.semesterNo)} ·{' '}
              {p.kind === 'SEMESTER_START'
                ? 'শুরুর দিন'
                : `${PHASE_BN[p.phase]}${p.weekNo > 1 || p.phase === 'CLASS' || p.phase === 'EXAM' ? ` ${bnDigits(p.weekNo)}` : ''}`}
            </span>
            <button
              type="button"
              className="ml-auto text-xs text-red-700 underline dark:text-red-400"
              onClick={async () => {
                const r = await api(`/api/admin/positions/${p.id}`, { method: 'DELETE' });
                if (!r.ok) return toast(r.message, 'error');
                toast('মুছে ফেলা হয়েছে।');
                setVersion((v) => v + 1);
                onChanged();
              }}
            >
              মুছুন
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
