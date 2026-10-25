'use client';
import { useEffect, useState } from 'react';
import { milestones } from '@/core/semester/impact';
import { api } from '@/lib/api';
import {
  bnDate,
  delayLineBn,
  nextLineBn,
  PHASE_BN,
  PHASE_STYLE,
  stateLineBn,
  type TimelineResponse,
} from '@/lib/semester-ui';
import { Sheet } from './Sheet';
import { Legend, TimelineStrip } from './TimelineStrip';

/** The whole semester of one series: state on `date`, delays by holiday, and the week strip. */
export function TimelineDrawer({
  semesterId,
  date,
  onClose,
}: {
  semesterId: number;
  date: string;
  onClose: () => void;
}) {
  const [res, setRes] = useState<{ data?: TimelineResponse; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    api<TimelineResponse>(`/api/semesters/${semesterId}/timeline?date=${date}`).then((r) => {
      if (live) setRes(r.ok ? { data: r.data } : { error: r.message });
    });
    return () => {
      live = false;
    };
  }, [semesterId, date]);

  const d = res?.data;
  return (
    <Sheet
      title={
        d
          ? `${d.semester.series} · সেমিস্টার${d.semester.label ? ` ${d.semester.label}` : ''}`
          : 'সেমিস্টার'
      }
      onClose={onClose}
    >
      {!res ? (
        <p className="text-sm">লোড হচ্ছে…</p>
      ) : res.error || !d ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {res.error}
        </p>
      ) : (
        <div className="space-y-4">
          <section aria-label={`${bnDate(date, true)} তারিখের অবস্থা`} className="space-y-1">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{bnDate(date, true)} তারিখে</p>
            <p className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded px-2 py-0.5 text-sm font-medium ${PHASE_STYLE[d.state.phase].badge}`}
              >
                {PHASE_BN[d.state.phase]}
              </span>
              <span className="text-sm">{stateLineBn(d.state)}</span>
            </p>
            {nextLineBn(d.state) && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                পরবর্তী: {nextLineBn(d.state)}
              </p>
            )}
          </section>

          <section aria-labelledby="strip">
            <h3 id="strip" className="mb-1 text-sm font-semibold">
              পুরো সেমিস্টার · {bnDate(d.startDate, true)} – {bnDate(d.endDate, true)}
            </h3>
            <TimelineStrip weeks={d.weeks} today={date} />
            <Legend />
          </section>

          <section aria-labelledby="milestones">
            <h3 id="milestones" className="mb-1 text-sm font-semibold">
              কবে কী শুরু
            </h3>
            <ul className="space-y-1 text-sm">
              {milestones(d).map((m) => (
                <li key={m.segment} className="flex items-center gap-2">
                  <span
                    className={`inline-block h-3 w-3 rounded-sm ${PHASE_STYLE[m.phase].strip}`}
                    aria-hidden
                  />
                  {PHASE_BN[m.phase]} · {bnDate(m.date, true)}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="delays">
            <h3 id="delays" className="mb-1 text-sm font-semibold">
              দেরির কারণ
            </h3>
            {d.state.reasons.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">কোনো দেরি নেই।</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.state.reasons.map((g) => (
                  <li key={g.from}>
                    <span className="font-medium">{delayLineBn(g)}</span>{' '}
                    <span className="text-zinc-500 dark:text-zinc-400">
                      ({bnDate(g.from)}
                      {g.from !== g.to ? ` থেকে ${bnDate(g.to)}-এর সপ্তাহ` : ''})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
