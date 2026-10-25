'use client';
import { bnDate, PHASE_BN, PHASE_STYLE, SKIPPED_STRIP, type TimelineWeek } from '@/lib/semester-ui';

const weekTitle = (w: TimelineWeek) => {
  const when = bnDate(w.weekStart);
  if (w.status === 'COUNTED') {
    const n = w.phaseWeekIndex ? ` · সপ্তাহ ${w.phaseWeekIndex}` : '';
    return `${when}: ${PHASE_BN[w.phase]}${n}${w.reason ? ` (${w.reason})` : ''}`;
  }
  return `${when}: ${w.reason ?? 'ছুটির সপ্তাহ'} (গণনা হয়নি)`;
};

/**
 * Every week of a semester as a coloured block: phases coloured, skipped weeks hatched, the
 * week containing `today` outlined. Scrolls sideways on a phone. With `onPick` each block is a
 * button (the admin uses it to pick a week to extend).
 */
export function TimelineStrip({
  weeks,
  today,
  onPick,
  selected,
}: {
  weeks: TimelineWeek[];
  today?: string;
  onPick?: (w: TimelineWeek) => void;
  selected?: string | null;
}) {
  return (
    <div
      className="overflow-x-auto pb-2"
      tabIndex={0}
      aria-label="সেমিস্টারের সপ্তাহ-ভিত্তিক সময়রেখা"
    >
      <ol className="flex w-max gap-0.5">
        {weeks.map((w) => {
          const skipped = w.status !== 'COUNTED';
          const isToday = !!today && today >= w.weekStart && today < addWeek(w.weekStart);
          const look = `${skipped ? SKIPPED_STRIP : PHASE_STYLE[w.phase].strip} ${
            isToday ? 'outline-2 outline-offset-1 outline-zinc-900 dark:outline-white' : ''
          } ${selected === w.weekStart ? 'ring-2 ring-indigo-500' : ''}`;
          const cls = `grid h-11 w-7 place-items-center rounded-sm text-[10px] font-semibold text-white ${look}`;
          const label = skipped ? '' : String(w.phaseWeekIndex ?? '');
          return (
            <li key={w.weekStart}>
              {onPick ? (
                <button
                  type="button"
                  className={`${cls} focus-visible:outline-2 focus-visible:outline-indigo-500`}
                  title={weekTitle(w)}
                  aria-label={weekTitle(w)}
                  onClick={() => onPick(w)}
                >
                  {label}
                </button>
              ) : (
                <span className={cls} title={weekTitle(w)} role="img" aria-label={weekTitle(w)}>
                  {label}
                </span>
              )}
              <span className="block text-center text-[9px] text-zinc-500 dark:text-zinc-400">
                {monthMark(w.weekStart)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function addWeek(iso: string) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** The month name under the first week that starts in a month (or at the very beginning). */
function monthMark(iso: string) {
  const day = Number(iso.slice(8, 10));
  return day <= 7
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('bn-BD', { month: 'short', timeZone: 'UTC' })
    : ' ';
}

export function Legend() {
  const items = [
    ['CLASS', PHASE_STYLE.CLASS.strip],
    ['MID_BREAK', PHASE_STYLE.MID_BREAK.strip],
    ['VIVA', PHASE_STYLE.VIVA.strip],
    ['FINALS', PHASE_STYLE.FINALS.strip],
  ] as const;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {items.map(([p, c]) => (
        <li key={p} className="flex items-center gap-1">
          <span className={`inline-block h-3 w-3 rounded-sm ${c}`} aria-hidden />
          {PHASE_BN[p]}
        </li>
      ))}
      <li className="flex items-center gap-1">
        <span className={`inline-block h-3 w-3 rounded-sm ${SKIPPED_STRIP}`} aria-hidden />
        ছুটির সপ্তাহ (গণনা হয়নি)
      </li>
    </ul>
  );
}
