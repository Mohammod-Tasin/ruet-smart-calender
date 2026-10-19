import type { PublicHoliday } from '@/lib/api';
import { dateRange, stamp } from '@/lib/format';

export const labelColor = (label: string) =>
  label === 'ALL'
    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'
    : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200';

/** Title, audience, dates, note and "set by". `actions` is the admin's button row. */
export function HolidayCard({
  holiday: h,
  actions,
}: {
  holiday: Pick<
    PublicHoliday,
    'title' | 'label' | 'startDate' | 'endDate' | 'note' | 'updatedAt'
  > & {
    updatedBy: { name: string };
  };
  actions?: React.ReactNode;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="font-medium">{h.title}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${labelColor(h.label)}`}>
          {h.label}
        </span>
        <span className="text-zinc-600 dark:text-zinc-400">
          {dateRange(h.startDate, h.endDate)}
        </span>
      </p>
      {h.note && <p className="mt-2 text-sm whitespace-pre-line">{h.note}</p>}
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Set by {h.updatedBy.name} · {stamp(h.updatedAt)}
      </p>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
