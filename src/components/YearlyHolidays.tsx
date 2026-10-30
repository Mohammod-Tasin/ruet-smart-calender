'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { addDays } from '@/core/calendar/hijri';
import { todayInDhaka } from '@/core/calendar/grid';
import type { HijriPoint, RuleDef, RuleKind, RuleParams, RuleYear } from '@/core/calendar/rules';
import { api, type ApiStructure } from '@/lib/api';
import { audienceText, dateRange, stamp, trimNote } from '@/lib/format';
import { useStructure } from '@/lib/hooks';
import { HIJRI_MONTHS, KIND_LABEL, WEEKDAYS_EN, ruleName, ruleSummary } from '@/lib/rule-summary';
import type { ImpactGroup } from '@/core/journey/impact';
import { AudiencePicker } from './AudiencePicker';
import { hasChange, ImpactGroups, ImpactPreview, useShiftConfirm } from './ImpactPreview';
import { Sheet } from './Sheet';
import { TrimHint } from './TrimHint';
import { useToast } from './Toast';

interface RuleItem extends RuleDef {
  label: string;
  updatedBy: { name: string };
  updatedAt: string;
  yearInfo:
    | (RuleYear & {
        note: string | null;
        updatedBy: { name: string } | null;
        updatedAt: string | null;
      })
    | null;
}
interface Listing {
  year: number;
  bdOffset: number;
  rules: RuleItem[];
  datesNeeded: { year: number; rules: { id: number; title: string }[] }[];
}

const small =
  'rounded-md border border-zinc-300 px-2.5 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800';
const field =
  'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900';

type Dialog =
  | { kind: 'rule'; rule: RuleItem | null }
  | { kind: 'end'; rule: RuleItem }
  | { kind: 'dates'; rule: RuleItem; year: number }
  | { kind: 'year'; year: number };

/** The yearly list, shown inside the admin calendar screen (needs the admin shell's toasts). */
export function YearlyHolidays({ offDays }: { offDays: number[] }) {
  const router = useRouter();
  const toast = useToast();
  const params = useSearchParams();
  const thisYear = Number(todayInDhaka().slice(0, 4));
  const year = Number(params.get('year')) || thisYear;
  const { structure } = useStructure();
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [pending, setPending] = useState<{
    title: string;
    groups: ImpactGroup[];
    apply: () => void;
  } | null>(null);

  useEffect(() => {
    let live = true;
    api<Listing>(`/api/admin/holiday-rules?year=${year}`).then((r) => {
      if (!live) return;
      if (r.ok) {
        setData(r.data);
        setError(null);
      } else if (r.status === 401) router.replace('/admin/login');
      else setError(r.message);
    });
    return () => {
      live = false;
    };
  }, [year, version, router]);

  const reload = () => setVersion((v) => v + 1);
  const setYear = (y: number) => router.replace(`/admin?tab=calendar&view=yearly&year=${y}`);

  /** One call for every write; shows the outcome and reloads. */
  const send = useCallback(
    async (path: string, method: string, body: unknown, done: string, ruleId?: number) => {
      if (ruleId) setBusy(ruleId);
      const r = await api(`/api/admin/holiday-rules${path}`, { method, body });
      setBusy(null);
      if (!r.ok) {
        toast(
          r.status === 401 ? 'Your session expired. Please sign in again.' : r.message,
          'error',
        );
        return false;
      }
      const trimmed = (r.data as { trimmed?: { startDate: string; endDate: string } } | null)
        ?.trimmed;
      toast(trimmed ? `${done} ${trimNote(trimmed, offDays)}` : done);
      setDialog(null);
      reload();
      return true;
    },
    [toast, offDays],
  );

  const override = (rule: RuleItem, body: Record<string, unknown>, done: string) =>
    send(`/${rule.id}/overrides`, 'PUT', { year, ...body }, done, rule.id);

  /**
   * One-click changes ask the server what they would do to running semesters first. If nothing
   * moves, the change is applied straight away; otherwise the admin sees the impact and confirms.
   */
  async function guarded(
    rule: RuleItem,
    newDates: { startDate: string; endDate: string } | null,
    title: string,
    apply: () => void,
  ) {
    const change = {
      removeIds: rule.yearInfo?.final ? [`rule:${rule.id}:${year}`] : undefined,
      add: newDates ? [{ ...newDates, audience: rule.audience }] : undefined,
    };
    if (!hasChange(change)) return apply();
    const r = await api<{ groups: ImpactGroup[] }>('/api/admin/impact', {
      method: 'POST',
      body: change,
    });
    if (r.ok && r.data.groups.length > 0) setPending({ title, groups: r.data.groups, apply });
    else apply();
  }

  function shift(rule: RuleItem, n: number) {
    const info = rule.yearInfo?.final ?? rule.yearInfo?.computed;
    if (!info) return;
    const dates = { startDate: addDays(info.startDate, n), endDate: addDays(info.endDate, n) };
    const sign = n > 0 ? '+' : '−';
    void guarded(rule, dates, `${ruleName(rule)}: ${sign}1 day`, () =>
      override(rule, dates, `Moved ${sign}1 day.`),
    );
  }

  const today = todayInDhaka();
  const needed = data?.datesNeeded.filter((d) => d.rules.length > 0) ?? [];
  const rules = data?.rules ?? [];
  const missing = rules.filter(
    (r) =>
      r.params.kind === 'MANUAL_YEARLY' && r.yearInfo && !r.yearInfo.final && !r.yearInfo.skipped,
  );
  const sighting = rules.filter((r) => {
    const f = r.yearInfo?.final;
    return (
      r.params.kind === 'HIJRI' &&
      !r.yearInfo?.skipped &&
      !r.yearInfo?.confirmed &&
      f?.tentative &&
      f.startDate >= today &&
      f.startDate <= addDays(today, 60)
    );
  });
  const action = new Set([...missing, ...sighting].map((r) => r.id));
  const fixed = rules.filter((r) => r.params.kind === 'GREGORIAN_FIXED');
  const moon = rules.filter((r) => r.params.kind === 'HIJRI' && !action.has(r.id));
  const manual = rules.filter((r) => r.params.kind === 'MANUAL_YEARLY' && !action.has(r.id));

  const row = (r: RuleItem) => (
    <RuleRow
      key={r.id}
      rule={r}
      year={year}
      busy={busy === r.id}
      onEdit={() => setDialog({ kind: 'rule', rule: r })}
      onEnd={() => setDialog({ kind: 'end', rule: r })}
      onDates={() => setDialog({ kind: 'dates', rule: r, year })}
      onShift={(n) => shift(r, n)}
      onConfirm={() => {
        const info = r.yearInfo?.final ?? r.yearInfo?.computed;
        void guarded(r, info ?? null, `${ruleName(r)}: confirm date`, () =>
          override(r, { confirmed: true }, 'Confirmed.'),
        );
      }}
      onSkip={(skipped) =>
        guarded(
          r,
          skipped ? null : (r.yearInfo?.computed ?? null),
          `${ruleName(r)}: ${skipped ? 'skip' : 'include'} ${year}`,
          () =>
            override(r, { skipped }, skipped ? `Skipped for ${year}.` : `Restored for ${year}.`),
        )
      }
      onReset={() =>
        guarded(r, r.yearInfo?.computed ?? null, `${ruleName(r)}: back to computed dates`, () =>
          send(`/${r.id}/overrides`, 'DELETE', { year }, 'Back to computed dates.', r.id),
        )
      }
    />
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2 px-1">
        <Link href="/admin?tab=calendar" className={small}>
          ← Calendar
        </Link>
        <h2 className="mr-auto text-xl font-bold">Yearly holidays</h2>
      </header>

      <div className="flex flex-wrap items-center gap-2 px-1">
        <button
          type="button"
          className={small}
          onClick={() => setYear(year - 1)}
          aria-label="Previous year"
        >
          ‹
        </button>
        <span className="min-w-14 text-center font-semibold">{year}</span>
        <button
          type="button"
          className={small}
          onClick={() => setYear(year + 1)}
          aria-label="Next year"
        >
          ›
        </button>
        {year !== thisYear && (
          <button type="button" className={small} onClick={() => setYear(thisYear)}>
            This year
          </button>
        )}
        <button
          type="button"
          className={`${small} ml-auto bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500`}
          onClick={() => setDialog({ kind: 'rule', rule: null })}
        >
          + Add yearly holiday
        </button>
      </div>

      {error && (
        <p role="alert" className="px-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {data === null && !error ? (
        <p className="px-1 text-sm">Loading…</p>
      ) : (
        <div className="grid gap-3">
          <section aria-label="Needs your action" className="space-y-2">
            <h3 className="px-1 text-sm font-semibold">Needs your action</h3>
            {needed.map((d) => (
              <div
                key={d.year}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
              >
                <p className="min-w-0 flex-1 text-sm text-amber-950 dark:text-amber-50">
                  <b>
                    Add {d.year} holiday dates ({d.rules.length}{' '}
                    {d.rules.length === 1 ? 'holiday' : 'holidays'})
                  </b>
                  : {d.rules.map((r) => r.title).join(', ')}
                </p>
                <button
                  type="button"
                  className={`${small} bg-white dark:bg-zinc-900`}
                  onClick={() => setDialog({ kind: 'year', year: d.year })}
                >
                  Add dates
                </button>
              </div>
            ))}
            {[...missing, ...sighting].map(row)}
            {needed.length === 0 && action.size === 0 && (
              <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">
                Nothing needs your action.
              </p>
            )}
          </section>

          <Fold title="Automatic every year" count={fixed.length}>
            {fixed.map(row)}
          </Fold>
          <Fold title="Moon-based" count={moon.length}>
            {moon.map(row)}
          </Fold>
          {manual.length > 0 && (
            <Fold title="Dates you entered" count={manual.length}>
              {manual.map(row)}
            </Fold>
          )}
          {rules.length === 0 && (
            <p className="px-1 text-sm text-zinc-600 dark:text-zinc-400">No yearly holidays yet.</p>
          )}
        </div>
      )}
      {data && (
        <p className="px-1 text-xs text-zinc-500 dark:text-zinc-400">
          Moon-based dates come from the Saudi (umalqura) calendar plus {data.bdOffset} day for
          Bangladesh moon sighting, and stay &quot;expected&quot; until you confirm them.
        </p>
      )}

      {dialog?.kind === 'rule' && structure && (
        <RuleForm
          structure={structure}
          rule={dialog.rule}
          defaultYear={year}
          onClose={() => setDialog(null)}
          onSave={(body, editingId) =>
            editingId
              ? send(`/${editingId}`, 'PATCH', body, 'Saved.')
              : send('', 'POST', body, 'Yearly holiday added.')
          }
        />
      )}
      {dialog?.kind === 'end' && (
        <EndForm
          rule={dialog.rule}
          defaultYear={year}
          onClose={() => setDialog(null)}
          onEnd={(fromYear) =>
            send(`/${dialog.rule.id}`, 'DELETE', { fromYear }, `Ended from ${fromYear}.`)
          }
        />
      )}
      {pending && (
        <Sheet title="Effect on semesters" onClose={() => setPending(null)}>
          <div className="space-y-4">
            <p className="text-sm font-medium">{pending.title}</p>
            <ImpactGroups groups={pending.groups} />
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white"
                onClick={() => {
                  const run = pending.apply;
                  setPending(null);
                  run();
                }}
              >
                Do it anyway
              </button>
              <button type="button" className={small} onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {dialog?.kind === 'year' && data && (
        <YearDatesForm
          year={dialog.year}
          offDays={offDays}
          rules={data.rules.filter((r) =>
            data.datesNeeded.find((d) => d.year === dialog.year)?.rules.some((x) => x.id === r.id),
          )}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog?.kind === 'dates' && (
        <DatesForm
          rule={dialog.rule}
          offDays={offDays}
          year={dialog.year}
          current={!!dialog.rule.yearInfo?.final && dialog.year === year}
          onClose={() => setDialog(null)}
          onSave={(body) =>
            send(
              `/${dialog.rule.id}/overrides`,
              'PUT',
              { year: dialog.year, ...body },
              'Dates saved.',
            )
          }
        />
      )}
    </div>
  );
}

/** A collapsed group of rows. */
function Fold({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
        {title} ({count})
      </summary>
      <div className="grid gap-2 p-2">{children}</div>
    </details>
  );
}

/** "More" menu: a <details> that closes itself after a choice. */
function More({ children }: { children: React.ReactNode }) {
  return (
    <details className="relative">
      <summary className={`${small} cursor-pointer list-none`}>More</summary>
      <div
        className="absolute right-0 z-20 mt-1 grid min-w-44 gap-0.5 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')}
      >
        {children}
      </div>
    </details>
  );
}
const item =
  'rounded-md px-3 py-2 text-left text-sm hover:bg-zinc-100 disabled:opacity-60 dark:hover:bg-zinc-800';

/**
 * One yearly holiday for the selected year. At most two visible buttons: the main action (when
 * there is one) and "More"; everything else lives in the menu.
 */
function RuleRow({
  rule,
  year,
  busy,
  onEdit,
  onEnd,
  onDates,
  onShift,
  onConfirm,
  onSkip,
  onReset,
}: {
  rule: RuleItem;
  year: number;
  busy: boolean;
  onEdit: () => void;
  onEnd: () => void;
  onDates: () => void;
  onShift: (n: number) => void;
  onConfirm: () => void;
  onSkip: (skipped: boolean) => void;
  onReset: () => void;
}) {
  const info = rule.yearInfo;
  const kind = rule.params.kind;
  const isHijri = kind === 'HIJRI';
  const years = `${rule.effectiveFromYear}${rule.effectiveToYear ? `–${rule.effectiveToYear}` : ' onward'}`;
  const hasOverride = !!info?.updatedBy;
  const final = info && !info.skipped ? info.final : null;
  const needsDates = kind === 'MANUAL_YEARLY' && info && !info.skipped && !info.final;
  const needsSighting = isHijri && !!final && !info?.confirmed;

  return (
    <article
      className={`rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 ${info ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{ruleName(rule)}</h4>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
          {KIND_LABEL[kind]}
        </span>
        {rule.classesOnly && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
            Classes off · offices open
          </span>
        )}
        <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800 dark:bg-green-950 dark:text-green-200">
          {audienceText(rule.label)}
        </span>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {ruleSummary(rule.params)} · active {years}
      </p>

      <p className="mt-2 text-sm" aria-live="polite">
        <b>{year}:</b>{' '}
        {!info ? (
          'not active this year'
        ) : info.skipped ? (
          'skipped'
        ) : final ? (
          <>
            {needsSighting ? 'expected ' : ''}
            {dateRange(final.startDate, final.endDate)}
            {final.tentative && (
              <span className="ml-2 rounded border border-dashed border-red-500 px-1.5 py-0.5 text-xs text-red-700 dark:text-red-300">
                Expected
              </span>
            )}
            {isHijri && info.confirmed && (
              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                Confirmed
              </span>
            )}
          </>
        ) : (
          <span className="font-medium text-amber-700 dark:text-amber-400">Dates needed</span>
        )}
      </p>
      {hasOverride && info?.updatedAt && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Set by {info.updatedBy!.name} · {stamp(info.updatedAt)}
          {info.note ? ` · ${info.note}` : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsDates && (
          <button type="button" className={small} disabled={busy} onClick={onDates}>
            Set dates
          </button>
        )}
        {needsSighting && (
          <button
            type="button"
            className={`${small} border-emerald-700 text-emerald-800 dark:text-emerald-300`}
            disabled={busy}
            onClick={onConfirm}
          >
            Confirm date
          </button>
        )}
        <More>
          {isHijri && final && (
            <>
              <button type="button" className={item} disabled={busy} onClick={() => onShift(1)}>
                1 day later
              </button>
              <button type="button" className={item} disabled={busy} onClick={() => onShift(-1)}>
                1 day earlier
              </button>
            </>
          )}
          {info && !info.skipped && kind !== 'GREGORIAN_FIXED' && (
            <button type="button" className={item} disabled={busy} onClick={onDates}>
              Set exact dates
            </button>
          )}
          {info && (
            <button
              type="button"
              className={item}
              disabled={busy}
              onClick={() => onSkip(!info.skipped)}
            >
              {info.skipped ? `Include ${year}` : `Skip ${year}`}
            </button>
          )}
          {hasOverride && (
            <button type="button" className={item} disabled={busy} onClick={onReset}>
              Reset {year}
            </button>
          )}
          <button type="button" className={item} disabled={busy} onClick={onEdit}>
            Edit rule
          </button>
          <button type="button" className={item} disabled={busy} onClick={onEnd}>
            End rule
          </button>
        </More>
      </div>
    </article>
  );
}

function EndForm({
  rule,
  defaultYear,
  onClose,
  onEnd,
}: {
  rule: RuleItem;
  defaultYear: number;
  onClose: () => void;
  onEnd: (fromYear: number) => void;
}) {
  const [fromYear, setFromYear] = useState(defaultYear);
  return (
    <Sheet title={`End: ${ruleName(rule)}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onEnd(fromYear);
        }}
      >
        <label className="block text-sm font-medium">
          From which year should it stop?
          <input
            type="number"
            className={field}
            value={fromYear}
            min={2000}
            max={2100}
            onChange={(e) => setFromYear(Number(e.target.value))}
          />
        </label>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Years before {fromYear} keep this holiday exactly as it was.
        </p>
        <FormButtons label={`End from ${fromYear}`} onClose={onClose} danger />
      </form>
    </Sheet>
  );
}

function DatesForm({
  rule,
  year,
  current,
  offDays,
  onClose,
  onSave,
}: {
  rule: RuleItem;
  offDays: number[];
  year: number;
  /** the rule currently shows dates for this year (they would be replaced) */
  current: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const known = rule.yearInfo?.final ?? rule.yearInfo?.computed;
  const [start, setStart] = useState(known?.startDate ?? '');
  const [end, setEnd] = useState(known?.endDate ?? '');
  const [note, setNote] = useState(rule.yearInfo?.note ?? '');
  const ok = !!start && !!end && end >= start;
  const impactChange = ok
    ? {
        removeIds: current ? [`rule:${rule.id}:${year}`] : undefined,
        add: [{ startDate: start, endDate: end, audience: rule.audience }],
      }
    : null;
  const confirm = useShiftConfirm(impactChange);
  return (
    <Sheet title={`${ruleName(rule)} · ${year}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok || !confirm.proceed()) return;
          onSave({
            startDate: start,
            endDate: end,
            note: note || null,
            confirmed: rule.params.kind === 'HIJRI' ? true : undefined,
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            From
            <input
              type="date"
              className={field}
              value={start}
              required
              onChange={(e) => {
                setStart(e.target.value);
                if (!end || end < e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label className="block text-sm font-medium">
            To
            <input
              type="date"
              className={field}
              value={end}
              required
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>
        <label className="block text-sm font-medium">
          Note <span className="font-normal text-zinc-500">(optional)</span>
          <input
            className={field}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {rule.params.kind === 'HIJRI' && (
          <p className="text-xs text-zinc-500">Saving exact dates also confirms them.</p>
        )}
        <TrimHint start={start} end={end} offDays={offDays} />
        <ImpactPreview change={impactChange} impact={confirm.impact} />
        <FormButtons
          label={confirm.armed ? 'Confirm and save' : 'Save dates'}
          onClose={onClose}
          disabled={!ok}
        />
      </form>
    </Sheet>
  );
}

function FormButtons({
  label,
  onClose,
  disabled,
  danger,
}: {
  label: string;
  onClose: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
      <button
        disabled={disabled}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${danger ? 'bg-red-700' : 'bg-indigo-600'}`}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
      >
        Cancel
      </button>
    </div>
  );
}

// --- Add / edit a rule -----------------------------------------------------------------------

const pt = (p?: HijriPoint): HijriPoint => p ?? { month: 9, day: 1, offsetDays: 0 };

function RuleForm({
  structure,
  rule,
  defaultYear,
  onClose,
  onSave,
}: {
  structure: ApiStructure;
  rule: RuleItem | null;
  defaultYear: number;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, editingId?: number) => void;
}) {
  const p = rule?.params;
  const [title, setTitle] = useState(rule?.title ?? '');
  const [classesOnly, setClassesOnly] = useState(rule?.classesOnly ?? false);
  const [kind, setKind] = useState<RuleKind>(p?.kind ?? 'MANUAL_YEARLY');
  const [fromYear, setFromYear] = useState(defaultYear);
  const [selected, setSelected] = useState(() =>
    rule ? coveredSeriesIds(rule.audience, structure) : new Set<number>(),
  );

  // Params, one small state per kind.
  const [fixed, setFixed] = useState(
    p?.kind === 'GREGORIAN_FIXED' ? p : { month: 1, day: 1, lengthDays: 1 },
  );
  const [hMode, setHMode] = useState<'RANGE' | 'LAST_WEEKDAY'>(
    p && 'type' in p ? 'LAST_WEEKDAY' : 'RANGE',
  );
  const [hStart, setHStart] = useState(
    pt(p?.kind === 'HIJRI' && 'startHijri' in p ? p.startHijri : undefined),
  );
  const [hEnd, setHEnd] = useState(
    pt(p?.kind === 'HIJRI' && 'endHijri' in p ? p.endHijri : undefined),
  );
  const [single, setSingle] = useState(
    p?.kind === 'HIJRI' && 'startHijri' in p
      ? JSON.stringify(p.startHijri) === JSON.stringify(p.endHijri)
      : true,
  );
  const [last, setLast] = useState(
    p?.kind === 'HIJRI' && 'type' in p
      ? { month: p.hijriMonth, weekday: p.weekday }
      : { month: 9, weekday: 5 },
  );
  const [manualLen, setManualLen] = useState(p?.kind === 'MANUAL_YEARLY' ? p.defaultLengthDays : 1);

  const audience = useMemo(() => audienceFromSeries(selected, structure), [selected, structure]);
  const [error, setError] = useState<string | null>(null);

  function params(): RuleParams {
    if (kind === 'GREGORIAN_FIXED') return { kind, ...fixed };
    if (kind === 'MANUAL_YEARLY') return { kind, defaultLengthDays: manualLen };
    if (hMode === 'LAST_WEEKDAY') {
      return { kind, type: 'LAST_WEEKDAY', hijriMonth: last.month, weekday: last.weekday };
    }
    return { kind, startHijri: hStart, endHijri: single ? hStart : hEnd };
  }

  function submit() {
    setError(null);
    if (!title.trim()) return setError('Please enter a title.');
    if (audience.length === 0) return setError('Please choose who is off.');
    const body = { title, classesOnly, category: 'HOLIDAY', audience, params: params() };
    if (rule) onSave({ ...body, fromYear }, rule.id);
    else onSave({ ...body, effectiveFromYear: fromYear });
  }

  const num = (v: string) => Number(v) || 0;
  const hijriInputs = (value: HijriPoint, set: (p: HijriPoint) => void) => (
    <div className="grid grid-cols-3 gap-2">
      <label className="block text-xs font-medium">
        Month
        <select
          className={field}
          value={value.month}
          onChange={(e) => set({ ...value, month: num(e.target.value) })}
        >
          {HIJRI_MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {i + 1}. {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium">
        Day
        <input
          type="number"
          min={1}
          max={30}
          className={field}
          value={value.day}
          onChange={(e) => set({ ...value, day: num(e.target.value) })}
        />
      </label>
      <label className="block text-xs font-medium">
        ± days
        <input
          type="number"
          min={-60}
          max={60}
          className={field}
          value={value.offsetDays}
          onChange={(e) => set({ ...value, offsetDays: num(e.target.value) })}
        />
      </label>
    </div>
  );

  return (
    <Sheet title={rule ? `Edit: ${ruleName(rule)}` : 'New yearly holiday'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-sm font-medium">
          Title
          <input
            className={field}
            value={title}
            maxLength={100}
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={classesOnly}
            onChange={(e) => setClassesOnly(e.target.checked)}
          />
          Classes off only <span className="text-zinc-500">(offices stay open)</span>
        </label>

        <label className="block text-sm font-medium">
          Type
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as RuleKind)}
          >
            <option value="GREGORIAN_FIXED">Fixed date every year (e.g. 21 Feb)</option>
            <option value="HIJRI">Islamic date (moves ~11 days earlier each year)</option>
            <option value="MANUAL_YEARLY">Date entered by an admin each year</option>
          </select>
        </label>

        {kind === 'GREGORIAN_FIXED' && (
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium">
              Month
              <input
                type="number"
                min={1}
                max={12}
                className={field}
                value={fixed.month}
                onChange={(e) => setFixed({ ...fixed, month: num(e.target.value) })}
              />
            </label>
            <label className="block text-xs font-medium">
              Day
              <input
                type="number"
                min={1}
                max={31}
                className={field}
                value={fixed.day}
                onChange={(e) => setFixed({ ...fixed, day: num(e.target.value) })}
              />
            </label>
            <label className="block text-xs font-medium">
              Length (days)
              <input
                type="number"
                min={1}
                max={60}
                className={field}
                value={fixed.lengthDays}
                onChange={(e) => setFixed({ ...fixed, lengthDays: num(e.target.value) })}
              />
            </label>
          </div>
        )}

        {kind === 'MANUAL_YEARLY' && (
          <label className="block text-sm font-medium">
            Usual length (days)
            <input
              type="number"
              min={1}
              max={60}
              className={field}
              value={manualLen}
              onChange={(e) => setManualLen(num(e.target.value))}
            />
          </label>
        )}

        {kind === 'HIJRI' && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Defined as
              <select
                className={field}
                value={hMode}
                onChange={(e) => setHMode(e.target.value as 'RANGE' | 'LAST_WEEKDAY')}
              >
                <option value="RANGE">A date (or range) in a Hijri month</option>
                <option value="LAST_WEEKDAY">The last weekday of a Hijri month</option>
              </select>
            </label>
            {hMode === 'RANGE' ? (
              <>
                <p className="text-sm font-medium">Starts</p>
                {hijriInputs(hStart, setHStart)}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-600"
                    checked={single}
                    onChange={(e) => setSingle(e.target.checked)}
                  />
                  Single day
                </label>
                {!single && (
                  <>
                    <p className="text-sm font-medium">Ends</p>
                    {hijriInputs(hEnd, setHEnd)}
                  </>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium">
                  Month
                  <select
                    className={field}
                    value={last.month}
                    onChange={(e) => setLast({ ...last, month: num(e.target.value) })}
                  >
                    {HIJRI_MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {i + 1}. {m}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  Weekday
                  <select
                    className={field}
                    value={last.weekday}
                    onChange={(e) => setLast({ ...last, weekday: num(e.target.value) })}
                  >
                    {WEEKDAYS_EN.map((w, i) => (
                      <option key={w} value={i}>
                        {w}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <p className="text-xs text-zinc-500">
              “± days” moves the date after the Bangladesh offset, e.g. Eid-ul-Fitr vacation starts
              7 days before 1 Shawwal: day 1, month Shawwal, ± −7.
            </p>
          </div>
        )}

        <AudiencePicker structure={structure} selected={selected} onChange={setSelected} />

        <label className="block text-sm font-medium">
          {rule ? 'From which year? (earlier years stay as they were)' : 'First year'}
          <input
            type="number"
            min={2000}
            max={2100}
            className={field}
            value={fromYear}
            onChange={(e) => setFromYear(num(e.target.value))}
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <FormButtons label={rule ? `Save from ${fromYear}` : 'Add'} onClose={onClose} />
      </form>
    </Sheet>
  );
}

/** One form for every yearly holiday that still needs dates: a from/to pair per rule. */
function YearDatesForm({
  year,
  offDays,
  rules,
  onClose,
  onSaved,
}: {
  year: number;
  offDays: number[];
  rules: RuleItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [dates, setDates] = useState<Record<number, { start: string; end: string }>>({});
  const [saving, setSaving] = useState(false);
  const get = (id: number) => dates[id] ?? { start: '', end: '' };
  const set = (id: number, v: { start: string; end: string }) =>
    setDates((d) => ({ ...d, [id]: v }));
  const filled = rules.filter((r) => get(r.id).start && get(r.id).end);
  const bad = filled.some((r) => get(r.id).end < get(r.id).start);
  const impactChange =
    filled.length > 0 && !bad
      ? {
          add: filled.map((r) => ({
            startDate: get(r.id).start,
            endDate: get(r.id).end,
            audience: r.audience,
          })),
        }
      : null;
  const confirm = useShiftConfirm(impactChange);

  async function save() {
    setSaving(true);
    let failed = 0;
    const trims: string[] = [];
    for (const r of filled) {
      const x = get(r.id);
      const res = await api<{ trimmed?: { startDate: string; endDate: string } }>(
        `/api/admin/holiday-rules/${r.id}/overrides`,
        {
          method: 'PUT',
          body: { year, startDate: x.start, endDate: x.end },
        },
      );
      if (!res.ok) {
        failed++;
        toast(`${ruleName(r)}: ${res.message}`, 'error');
      } else if (res.data?.trimmed)
        trims.push(`${ruleName(r)}: ${trimNote(res.data.trimmed, offDays)}`);
    }
    setSaving(false);
    const saved = filled.length - failed;
    if (saved > 0)
      toast(`Saved ${saved} ${saved === 1 ? 'holiday' : 'holidays'}. ${trims.join(' ')}`);
    if (failed === 0) onSaved();
  }

  return (
    <Sheet title={`Add ${year} holiday dates`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm.proceed()) void save();
        }}
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Fill in the dates you know now and leave the rest empty.
        </p>
        {rules.map((r) => {
          const x = get(r.id);
          const len = r.params.kind === 'MANUAL_YEARLY' ? r.params.defaultLengthDays : 1;
          return (
            <fieldset key={r.id} className="space-y-1">
              <legend className="text-sm font-medium">{ruleName(r)}</legend>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs">
                  From
                  <input
                    type="date"
                    className={field}
                    value={x.start}
                    onChange={(e) =>
                      set(r.id, {
                        start: e.target.value,
                        end:
                          !x.end || x.end < e.target.value
                            ? addDays(e.target.value, len - 1)
                            : x.end,
                      })
                    }
                  />
                </label>
                <label className="block text-xs">
                  To
                  <input
                    type="date"
                    className={field}
                    value={x.end}
                    min={x.start || undefined}
                    onChange={(e) => set(r.id, { ...x, end: e.target.value })}
                  />
                </label>
              </div>
              <TrimHint start={x.start} end={x.end} offDays={offDays} />
            </fieldset>
          );
        })}
        <ImpactPreview change={impactChange} impact={confirm.impact} />
        <FormButtons
          label={saving ? 'Saving…' : confirm.armed ? 'Confirm and save all' : 'Save all'}
          onClose={onClose}
          disabled={saving || bad || filled.length === 0}
        />
      </form>
    </Sheet>
  );
}
