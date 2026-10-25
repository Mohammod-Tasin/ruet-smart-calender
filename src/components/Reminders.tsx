'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { api } from '@/lib/api';
import { useStructure } from '@/lib/hooks';
import { bn } from '@/lib/rule-summary';
import type { AdminSemester, StatusResponse } from '@/lib/semester-ui';
import { small } from './ui';

interface Needed {
  year: number;
  rules: { id: number; title: string }[];
}

/**
 * Admin home reminders: yearly holiday dates still missing, series whose finals are over (start
 * the next semester), and series that have no active semester at all.
 */
export function Reminders() {
  const today = todayInDhaka();
  const year = Number(today.slice(0, 4));
  const { structure } = useStructure();
  const [needed, setNeeded] = useState<Needed[]>([]);
  const [ended, setEnded] = useState<string[]>([]);
  const [semesters, setSemesters] = useState<AdminSemester[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ datesNeeded: Needed[] }>(`/api/admin/holiday-rules?year=${year}`),
      api<StatusResponse>(`/api/status?date=${today}&t=${Date.now()}`),
      api<{ semesters: AdminSemester[] }>('/api/admin/semesters'),
    ]).then(([rules, status, sems]) => {
      if (!live) return;
      if (rules.ok) setNeeded(rules.data.datesNeeded.filter((d) => d.rules.length > 0));
      if (status.ok) {
        setEnded(
          status.data.series.filter((s) => s.state.phase === 'AWAITING_NEXT').map((s) => s.series),
        );
      }
      if (sems.ok) setSemesters(sems.data.semesters);
    });
    return () => {
      live = false;
    };
  }, [year, today]);

  const activeIds = new Set(
    (semesters ?? []).filter((s) => s.status === 'ACTIVE').map((s) => s.seriesId),
  );
  const none = structure && semesters ? structure.series.filter((s) => !activeIds.has(s.id)) : [];
  const nameOf = (id: number) => {
    const s = structure?.series.find((x) => x.id === id);
    const d = s && structure?.departments.find((x) => x.id === s.departmentId);
    return s && d ? `${d.code}-${String(s.intakeYear % 100).padStart(2, '0')}` : `#${id}`;
  };

  const items: { key: string; text: React.ReactNode; href: string; cta: string }[] = [
    ...needed.map((n) => ({
      key: `needed-${n.year}`,
      text: (
        <>
          <b>
            {n.year}: {bn(n.rules.length)}টি বাৎসরিক ছুটির তারিখ দিতে হবে
          </b>{' '}
          <span className="text-zinc-600 dark:text-zinc-400">
            ({n.rules.map((r) => r.title).join(', ')})
          </span>
        </>
      ),
      href: `/admin/yearly?year=${n.year}`,
      cta: 'তারিখ দিন',
    })),
    ...(ended.length > 0
      ? [
          {
            key: 'ended',
            text: (
              <>
                <b>সেমিস্টার শেষ — পরের সেমিস্টার শুরুর তারিখ দিন:</b> {ended.join(', ')}
              </>
            ),
            href: '/admin/semesters',
            cta: 'সেমিস্টার',
          },
        ]
      : []),
    ...(none.length > 0
      ? [
          {
            key: 'none',
            text: (
              <>
                <b>{bn(none.length)}টি সিরিজে কোনো সক্রিয় সেমিস্টার নেই</b>{' '}
                <span className="text-zinc-600 dark:text-zinc-400">
                  (
                  {none
                    .slice(0, 8)
                    .map((s) => nameOf(s.id))
                    .join(', ')}
                  {none.length > 8 ? '…' : ''})
                </span>
              </>
            ),
            href: '/admin/semesters',
            cta: 'চালু করুন',
          },
        ]
      : []),
  ];

  if (items.length === 0) return null;
  return (
    <section
      aria-label="মনে করিয়ে দেওয়া"
      className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
    >
      <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">করণীয়</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.key} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="min-w-0 flex-1">{i.text}</span>
            <Link href={i.href} className={`${small} bg-white dark:bg-zinc-900`}>
              {i.cta}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
