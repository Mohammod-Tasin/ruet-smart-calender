'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audienceFromSeries } from '@/core/calendar/audience';
import { coveredSeriesIds } from '@/core/calendar/compress';
import { todayInDhaka } from '@/core/calendar/grid';
import { addDays, msOf } from '@/core/calendar/hijri';
import { MONTHS_SHORT } from '@/core/calendar/months';
import type { HijriPoint, RuleDef, RuleKind, RuleParams, RuleYear } from '@/core/calendar/rules';
import type { ImpactGroup } from '@/core/journey/impact';
import { api, clearHolidayCache, type ApiStructure } from '@/lib/api';
import { audienceText, dateRange, stamp } from '@/lib/format';
import { useStructure } from '@/lib/hooks';
import { HIJRI_MONTHS, ruleName, ruleSummary, WEEKDAYS_EN } from '@/lib/rule-summary';
import { AudiencePicker } from './AudiencePicker';
import { hasChange, ImpactGroups, ImpactPreview, useShiftConfirm } from './ImpactPreview';
import { Sheet } from './Sheet';
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
  | { kind: 'rule'; rule: RuleItem | null; defaultKind?: RuleKind }
  | { kind: 'quick-variable' }
  | { kind: 'end'; rule: RuleItem }
  | { kind: 'dates'; rule: RuleItem; year: number }
  | { kind: 'year'; year: number };

/**
 * Common Holidays Manager (inside Admin -> Settings):
 * 1a. Yearly Fixed Common Holidays (same date every year — e.g. 21 Feb, 26 March, 16 Dec)
 * 1b. Yearly Variable Common Holidays (dates vary each year — e.g. Eid Vacation, Summer Vacation)
 */
export function YearlyHolidays() {
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

  // Deep link from the calendar: ?rule=ID&do=edit|end opens that rule's form once.
  const deepLinked = useRef(false);
  useEffect(() => {
    const id = Number(params.get('rule'));
    const rule = data?.rules.find((r) => r.id === id);
    if (!rule || deepLinked.current) return;
    deepLinked.current = true;
    setDialog(params.get('do') === 'end' ? { kind: 'end', rule } : { kind: 'rule', rule });
  }, [data, params]);

  const reload = () => {
    clearHolidayCache();
    setVersion((v) => v + 1);
  };
  const setYear = (y: number) => router.replace(`/admin?tab=settings&year=${y}`);

  const send = useCallback(
    async (path: string, method: string, body: unknown, done: string, ruleId?: number) => {
      if (ruleId) setBusy(ruleId);
      const call = (b: unknown) => api(`/api/admin/holiday-rules${path}`, { method, body: b });
      let r = await call(body);
      if (!r.ok && r.code === 'PAST_CONFIRM' && body && typeof body === 'object') {
        if (window.confirm(`${r.message}\n\nFix a past holiday?`)) {
          r = await call({ ...body, confirmPast: true });
        }
      }
      setBusy(null);
      if (!r.ok) {
        toast(
          r.status === 401 ? 'Your session expired. Please sign in again.' : r.message,
          'error',
        );
        return false;
      }
      toast(done);
      setDialog(null);
      reload();
      return true;
    },
    [toast],
  );

  const override = (rule: RuleItem, body: Record<string, unknown>, done: string) =>
    send(`/${rule.id}/overrides`, 'PUT', { year, ...body }, done, rule.id);

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

  const needed = data?.datesNeeded.filter((d) => d.rules.length > 0) ?? [];
  const rules = data?.rules ?? [];
  const fixedRules = rules.filter((r) => r.params.kind === 'GREGORIAN_FIXED');
  const variableRules = rules.filter((r) => r.params.kind !== 'GREGORIAN_FIXED');

  const row = (r: RuleItem) => (
    <RuleRow
      key={r.id}
      rule={r}
      year={year}
      busy={busy === r.id}
      onEdit={() => setDialog({ kind: 'rule', rule: r })}
      onRemove={() => setDialog({ kind: 'end', rule: r })}
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
            override(r, { skipped }, skipped ? `Removed for ${year}.` : `Restored for ${year}.`),
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
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div>
          <h2 className="text-lg font-bold">1. Common Holidays (For All)</h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Manage Yearly Fixed Holidays (same date every year) and Yearly Variable Holidays (Eid,
            Summer Vacation, etc.).
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Link href="/admin?tab=calendar" className={small}>
            ← Calendar
          </Link>
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
              {thisYear}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p role="alert" className="px-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {data === null && !error ? (
        <p className="px-1 text-sm">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Prompt banner if variable holidays still need dates for a year */}
          {needed.map((d) => (
            <div
              key={d.year}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
            >
              <p className="min-w-0 flex-1 text-sm text-amber-950 dark:text-amber-50">
                <b>
                  Set {d.year} dates ({d.rules.length}{' '}
                  {d.rules.length === 1 ? 'holiday' : 'holidays'})
                </b>
                : {d.rules.map((r) => r.title).join(', ')}
              </p>
              <button
                type="button"
                className={`${small} bg-white dark:bg-zinc-900`}
                onClick={() => setDialog({ kind: 'year', year: d.year })}
              >
                Set dates now
              </button>
            </div>
          ))}

          {/* 1a. Yearly Fixed Holidays */}
          <section className="space-y-2.5 rounded-lg border border-zinc-200 p-3.5 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">
                  a. Yearly Fixed Holidays ({fixedRules.length})
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Days are fixed every year (e.g. 21 Feb, 26 March, 14 April, 16 Dec).
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setDialog({ kind: 'rule', rule: null, defaultKind: 'GREGORIAN_FIXED' })
                }
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
              >
                + Add Fixed Holiday
              </button>
            </div>

            {fixedRules.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No yearly fixed holidays added yet.
              </p>
            ) : (
              <div className="grid gap-2">{fixedRules.map(row)}</div>
            )}
          </section>

          {/* 1b. Yearly Variable Holidays */}
          <section className="space-y-2.5 rounded-lg border border-zinc-200 p-3.5 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-bold">
                  b. Yearly Variable Holidays ({variableRules.length})
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Dates change each year (e.g. Eid Vacation, Summer Vacation, Winter Vacation, Puja
                  Vacation).
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'quick-variable' })}
                  className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  + Add Variable Holiday
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'rule', rule: null, defaultKind: 'HIJRI' })}
                  className={small}
                >
                  + Moon-based (Hijri)
                </button>
              </div>
            </div>

            {variableRules.length === 0 ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                No yearly variable holidays added yet.
              </p>
            ) : (
              <div className="grid gap-2">{variableRules.map(row)}</div>
            )}
          </section>
        </div>
      )}

      {dialog?.kind === 'quick-variable' && (
        <QuickVariableRuleForm
          year={year}
          onClose={() => setDialog(null)}
          onSaved={(msg) => {
            toast(msg);
            setDialog(null);
            reload();
          }}
        />
      )}

      {dialog?.kind === 'rule' && structure && (
        <RuleForm
          structure={structure}
          rule={dialog.rule}
          defaultKind={dialog.defaultKind}
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
            send(`/${dialog.rule.id}`, 'DELETE', { fromYear }, `Removed from ${fromYear} onward.`)
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

/** Super simple form to add a Yearly Variable Common Holiday (with optional dates for `year`). */
function QuickVariableRuleForm({
  year,
  onClose,
  onSaved,
}: {
  year: number;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) return setError('Please enter a holiday name.');
    if ((start && !end) || (!start && end)) {
      return setError('Enter both Start and End dates, or leave both blank to set later.');
    }
    if (start && end && end < start) {
      return setError('End date cannot be before Start date.');
    }

    const len =
      start && end
        ? Math.max(1, Math.min(60, Math.round((msOf(end) - msOf(start)) / 86_400_000) + 1))
        : 7;

    setSaving(true);
    const cr = await api<{ ruleId: number }>('/api/admin/holiday-rules', {
      method: 'POST',
      body: {
        title: title.trim(),
        category: 'HOLIDAY',
        classesOnly: false,
        audience: [{ scopeType: 'ALL', scopeId: null }],
        effectiveFromYear: year,
        params: { kind: 'MANUAL_YEARLY', defaultLengthDays: len },
      },
    });
    if (!cr.ok) {
      setSaving(false);
      return setError(cr.message);
    }

    if (start && end) {
      const or = await api(`/api/admin/holiday-rules/${cr.data.ruleId}/overrides`, {
        method: 'PUT',
        body: { year, startDate: start, endDate: end, confirmPast: true },
      });
      setSaving(false);
      if (!or.ok) return setError(or.message);
      return onSaved(`Added "${title.trim()}" with ${year} dates.`);
    }

    setSaving(false);
    onSaved(`Added "${title.trim()}" to Yearly Variable Holidays.`);
  }

  return (
    <Sheet title="Add Yearly Variable Holiday" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {[
            'Summer Vacation',
            'Winter Vacation',
            'Eid-ul-Fitr Vacation',
            'Eid-ul-Adha Vacation',
            'Durga Puja Vacation',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTitle(preset)}
              className="rounded border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-xs hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800"
            >
              + {preset}
            </button>
          ))}
        </div>

        <label className="block text-sm font-medium">
          Holiday Name
          <input
            className={field}
            placeholder="e.g. Summer Vacation, Eid Vacation…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">
            {year} Start Date <span className="text-xs font-normal text-zinc-500">(optional)</span>
            <input
              type="date"
              className={field}
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!end || end < e.target.value) setEnd(e.target.value);
              }}
            />
          </label>
          <label className="block text-sm font-medium">
            {year} End Date <span className="text-xs font-normal text-zinc-500">(optional)</span>
            <input
              type="date"
              className={field}
              value={end}
              min={start || undefined}
              onChange={(e) => setEnd(e.target.value)}
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}

        <FormButtons
          label={saving ? 'Saving…' : 'Add Variable Holiday'}
          onClose={onClose}
          disabled={saving}
        />
      </form>
    </Sheet>
  );
}

/** One yearly holiday row with direct, 1-click Edit / Set Dates / Skip / Remove buttons. */
function RuleRow({
  rule,
  year,
  busy,
  onEdit,
  onRemove,
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
  onRemove: () => void;
  onDates: () => void;
  onShift: (n: number) => void;
  onConfirm: () => void;
  onSkip: (skipped: boolean) => void;
  onReset: () => void;
}) {
  const info = rule.yearInfo;
  const kind = rule.params.kind;
  const isHijri = kind === 'HIJRI';
  const hasOverride = !!info?.updatedBy;
  const final = info && !info.skipped ? info.final : null;
  const needsSighting = isHijri && !!final && !info?.confirmed;

  return (
    <article
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800 ${info ? '' : 'opacity-60'}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">{ruleName(rule)}</h4>
          {rule.label !== 'ALL' && (
            <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
              {audienceText(rule.label)}
            </span>
          )}
        </div>

        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {ruleSummary(rule.params)}
        </p>

        <p className="mt-1 text-sm" aria-live="polite">
          <b>{year}:</b>{' '}
          {!info ? (
            'not active this year'
          ) : info.skipped ? (
            <span className="text-zinc-500">Skipped for {year}</span>
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
            <span className="font-medium text-amber-700 dark:text-amber-400">
              Dates not set yet
            </span>
          )}
        </p>
        {hasOverride && info?.updatedAt && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Updated by {info.updatedBy!.name} · {stamp(info.updatedAt)}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {kind !== 'GREGORIAN_FIXED' && info && !info.skipped && (
          <button
            type="button"
            className={`${small} border-indigo-300 text-indigo-700 dark:border-indigo-700 dark:text-indigo-300`}
            disabled={busy}
            onClick={onDates}
          >
            {final ? 'Change dates' : 'Set dates'}
          </button>
        )}
        {needsSighting && (
          <>
            <button
              type="button"
              className={`${small} border-emerald-700 text-emerald-800 dark:text-emerald-300`}
              disabled={busy}
              onClick={onConfirm}
            >
              Confirm
            </button>
            <button type="button" className={small} disabled={busy} onClick={() => onShift(-1)}>
              −1d
            </button>
            <button type="button" className={small} disabled={busy} onClick={() => onShift(1)}>
              +1d
            </button>
          </>
        )}
        {hasOverride && kind !== 'MANUAL_YEARLY' && (
          <button type="button" className={small} disabled={busy} onClick={onReset}>
            Reset
          </button>
        )}
        <button type="button" className={small} disabled={busy} onClick={onEdit}>
          Edit
        </button>
        {info && (
          <button
            type="button"
            className={small}
            disabled={busy}
            onClick={() => onSkip(!info.skipped)}
          >
            {info.skipped ? `Restore ${year}` : `Skip ${year}`}
          </button>
        )}
        <button
          type="button"
          className={`${small} border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50`}
          disabled={busy}
          onClick={onRemove}
        >
          Remove
        </button>
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
    <Sheet title={`Remove: ${ruleName(rule)}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onEnd(fromYear);
        }}
      >
        <label className="block text-sm font-medium">
          Remove starting from year
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
          Years before {fromYear} keep their history unchanged.
        </p>
        <FormButtons label={`Remove from ${fromYear} onward`} onClose={onClose} danger />
      </form>
    </Sheet>
  );
}

function DatesForm({
  rule,
  year,
  current,
  onClose,
  onSave,
}: {
  rule: RuleItem;
  year: number;
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
            Start Date
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
            End Date
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

const pt = (p?: HijriPoint): HijriPoint => p ?? { month: 9, day: 1, offsetDays: 0 };

function RuleForm({
  structure,
  rule,
  defaultKind,
  defaultYear,
  onClose,
  onSave,
}: {
  structure: ApiStructure;
  rule: RuleItem | null;
  defaultKind?: RuleKind;
  defaultYear: number;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, editingId?: number) => void;
}) {
  const p = rule?.params;
  const [title, setTitle] = useState(rule?.title ?? '');
  const [classesOnly, setClassesOnly] = useState(rule?.classesOnly ?? false);
  const [kind, setKind] = useState<RuleKind>(p?.kind ?? defaultKind ?? 'GREGORIAN_FIXED');
  const [fromYear, setFromYear] = useState(defaultYear);
  const [selected, setSelected] = useState(() =>
    rule ? coveredSeriesIds(rule.audience, structure) : new Set(structure.series.map((s) => s.id)),
  );
  const [showAdvancedAudience, setShowAdvancedAudience] = useState(
    () => !!rule && rule.label !== 'ALL',
  );

  const [fixed, setFixed] = useState(
    p?.kind === 'GREGORIAN_FIXED' ? p : { month: 2, day: 21, lengthDays: 1 },
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
  const [manualLen, setManualLen] = useState(p?.kind === 'MANUAL_YEARLY' ? p.defaultLengthDays : 7);

  const audience = useMemo(
    () =>
      showAdvancedAudience
        ? audienceFromSeries(selected, structure)
        : [{ scopeType: 'ALL' as const, scopeId: null }],
    [showAdvancedAudience, selected, structure],
  );
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
    <Sheet
      title={
        rule
          ? `Edit: ${ruleName(rule)}`
          : kind === 'GREGORIAN_FIXED'
            ? 'Add Yearly Fixed Holiday'
            : 'Add Yearly Holiday'
      }
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="block text-sm font-medium">
          Holiday Name
          <input
            className={field}
            value={title}
            maxLength={100}
            placeholder={
              kind === 'GREGORIAN_FIXED'
                ? 'e.g. Shaheed Day, Independence Day…'
                : 'e.g. Eid-ul-Fitr Vacation…'
            }
            required
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="block text-sm font-medium">
          Type
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as RuleKind)}
          >
            <option value="GREGORIAN_FIXED">a. Yearly Fixed (same date every year, e.g. 21 Feb)</option>
            <option value="MANUAL_YEARLY">
              b. Yearly Variable (admin sets start &amp; end dates each year)
            </option>
            <option value="HIJRI">b. Yearly Variable — Moon-based (Hijri calendar)</option>
          </select>
        </label>

        {kind === 'GREGORIAN_FIXED' && (
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium">
              Month
              <select
                className={field}
                value={fixed.month}
                onChange={(e) => setFixed({ ...fixed, month: num(e.target.value) })}
              >
                {MONTHS_SHORT.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
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
              Duration (days)
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
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-indigo-600"
            checked={classesOnly}
            onChange={(e) => setClassesOnly(e.target.checked)}
          />
          Classes off only <span className="text-zinc-500">(offices stay open)</span>
        </label>

        {showAdvancedAudience ? (
          <AudiencePicker structure={structure} selected={selected} onChange={setSelected} />
        ) : (
          <div className="flex items-center justify-between rounded-md bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
            <span>Applies to: <strong>All Departments &amp; Series (Common Holiday)</strong></span>
            <button
              type="button"
              onClick={() => setShowAdvancedAudience(true)}
              className="text-indigo-700 underline dark:text-indigo-300"
            >
              Customize
            </button>
          </div>
        )}

        {rule && (
          <label className="block text-sm font-medium">
            Apply changes starting from year
            <input
              type="number"
              min={2000}
              max={2100}
              className={field}
              value={fromYear}
              onChange={(e) => setFromYear(num(e.target.value))}
            />
          </label>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <FormButtons label={rule ? `Save from ${fromYear}` : 'Save Holiday'} onClose={onClose} />
      </form>
    </Sheet>
  );
}

function YearDatesForm({
  year,
  rules,
  onClose,
  onSaved,
}: {
  year: number;
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
    for (const r of filled) {
      const x = get(r.id);
      const res = await api(
        `/api/admin/holiday-rules/${r.id}/overrides`,
        {
          method: 'PUT',
          body: { year, startDate: x.start, endDate: x.end },
        },
      );
      if (!res.ok) {
        failed++;
        toast(`${ruleName(r)}: ${res.message}`, 'error');
      }
    }
    setSaving(false);
    const saved = filled.length - failed;
    if (saved > 0)
      toast(`Saved ${saved} ${saved === 1 ? 'holiday' : 'holidays'}.`);
    if (failed === 0) onSaved();
  }

  return (
    <Sheet title={`Set ${year} holiday dates`} onClose={onClose}>
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
                  Start Date
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
                  End Date
                  <input
                    type="date"
                    className={field}
                    value={x.end}
                    min={x.start || undefined}
                    onChange={(e) => set(r.id, { ...x, end: e.target.value })}
                  />
                </label>
              </div>
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
