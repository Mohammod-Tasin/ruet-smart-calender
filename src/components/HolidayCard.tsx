import type { PublicHoliday } from '@/lib/api';
import { audienceText, dateRange, stamp } from '@/lib/format';

export const labelColor = (label: string) =>
  label === 'ALL'
    ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200'
    : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200';

const badge =
  'rounded px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200';

/** Title, audience, dates and note. `actions` is the admin's button row; "set by" is admin-only. */
export function HolidayCard({
  holiday: h,
  actions,
}: {
  holiday: Pick<PublicHoliday, 'title' | 'label' | 'startDate' | 'endDate' | 'note' | 'updatedAt'> &
    Partial<Pick<PublicHoliday, 'classesOnly' | 'tentative' | 'source' | 'category'>> & {
      updatedBy: { name: string };
    };
  actions?: React.ReactNode;
  offDays?: number[];
}) {
  return (
    <article className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <h3 className="font-medium">{h.title}</h3>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        {h.label !== 'ALL' && (
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${labelColor(h.label)}`}>
            {audienceText(h.label)}
          </span>
        )}
        <span className="text-zinc-600 dark:text-zinc-400">
          {dateRange(h.startDate, h.endDate)}
        </span>
        {h.category === 'MID_BREAK' && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            Mid Break
          </span>
        )}
        {h.category === 'UNOFFICIAL_BREAK' && <span className={badge}>Unofficial Break</span>}
        {h.category === 'SEMESTER_BREAK' && (
          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-950 dark:text-orange-200">
            Semester Break
          </span>
        )}
        {h.category === 'EXAM' && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            Semester Final
          </span>
        )}
        {h.category === 'CLASS' && (
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            Classes
          </span>
        )}
        {h.tentative && (
          <span className="rounded border border-dashed border-red-500 px-1.5 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
            Expected date
          </span>
        )}
        {h.source === 'RULE' && <span className={badge}>Yearly</span>}
      </p>
      {h.note && !h.note.startsWith('Applies to:') && (
        <p className="mt-2 text-sm whitespace-pre-line">{h.note}</p>
      )}
      {actions && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Set by {h.updatedBy.name} · {stamp(h.updatedAt)}
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </article>
  );
}
