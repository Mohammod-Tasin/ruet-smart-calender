'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { planOccurrenceEdit, type EditScope } from '@/core/calendar/past';
import type { RuleParams } from '@/core/calendar/rules';
import { trimOffDays } from '@/core/calendar/trim';
import { isRealDate } from '@/core/validation/holidays-query';
import { api, type AuditEntry, type PublicHoliday } from '@/lib/api';
import { dateRange, stamp, weekendRange } from '@/lib/format';
import { ImpactPreview } from './ImpactPreview';
import { PastConfirm } from './PastConfirm';
import { Sheet } from './Sheet';
import { useToast } from './Toast';
import { TrimHint } from './TrimHint';
import { field, primary, small } from './ui';

const UNDO_MS = 10_000;

const weekday = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

export const yearlyRuleHref = (ruleId: number, year: number, open?: 'edit' | 'end') =>
  `/admin?tab=calendar&view=yearly&year=${year}&rule=${ruleId}${open ? `&do=${open}` : ''}`;

/**
 * Tap a bar of a yearly holiday: change its date (this year, or from a year on), remove it for
 * this year, or reach the rarer actions. The time rules are mirrored here from core/calendar/past
 * to disable choices early; the server enforces them again (it never trusts this).
 */
export function OccurrenceSheet({
  holiday: h,
  offDays,
  onClose,
  onChanged,
}: {
  holiday: PublicHoliday;
  offDays: number[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const ruleId = h.ruleId!;
  const year = h.year!;
  const today = useMemo(() => todayInDhaka(), []);
  const [step, setStep] = useState<'main' | 'change' | 'skip'>('main');
  const [params, setParams] = useState<RuleParams | null>(null);
  const [start, setStart] = useState(h.startDate);
  const [end, setEnd] = useState(h.endDate);
  const [picked, setPicked] = useState<EditScope>('ONLY_YEAR');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastMsg, setPastMsg] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    api<{ rules: { id: number; params: RuleParams }[] }>(
      `/api/admin/holiday-rules?year=${year}`,
    ).then((r) => {
      if (r.ok) setParams(r.data.rules.find((x) => x.id === ruleId)?.params ?? null);
    });
  }, [ruleId, year]);

  const kind = params?.kind ?? 'GREGORIAN_FIXED';
  const hasPattern =
    kind === 'GREGORIAN_FIXED' || (kind === 'HIJRI' && !!params && 'startHijri' in params);

  const datesOk = isRealDate(start) && isRealDate(end) && end >= start;
  const proposed = useMemo(
    () => (datesOk ? (trimOffDays({ startDate: start, endDate: end }, offDays) ?? null) : null),
    [datesOk, start, end, offDays],
  );
  const original = { startDate: h.startDate, endDate: h.endDate };
  const plans = useMemo(() => {
    const run = (scope: EditScope) =>
      proposed
        ? planOccurrenceEdit({
            today,
            year,
            ruleKind: kind,
            original,
            proposed,
            scope,
            confirmPast: false,
          })
        : null;
    return {
      ONLY_YEAR: run('ONLY_YEAR'),
      FROM_YEAR: run('FROM_YEAR'),
      FROM_NEXT_YEAR: run('FROM_NEXT_YEAR'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposed, today, year, kind, h.startDate, h.endDate]);

  const blocked = (s: EditScope) => {
    const p = plans[s];
    return p?.ok === false && p.code === 'UNPROCESSABLE';
  };
  const options: { scope: EditScope; label: string }[] = [
    { scope: 'ONLY_YEAR', label: `Only ${year}` },
    ...(hasPattern
      ? [
          { scope: 'FROM_YEAR' as const, label: `${year} and every year after` },
          { scope: 'FROM_NEXT_YEAR' as const, label: `Every year from ${year + 1}` },
        ]
      : []),
  ];
  const scope = options.find((o) => o.scope === picked && !blocked(o.scope))
    ? picked
    : (options.find((o) => !blocked(o.scope))?.scope ?? null);
  const plan = scope ? plans[scope] : null;
  const why =
    plans.ONLY_YEAR?.ok === false && plans.ONLY_YEAR.code === 'UNPROCESSABLE'
      ? plans.ONLY_YEAR.message
      : null;
  const unchanged = start === h.startDate && end === h.endDate;

  async function undo(undoId: number) {
    const r = await api('/api/admin/rule-edits/undo', { method: 'POST', body: { undoId } });
    toast(r.ok ? 'Change undone.' : r.message, r.ok ? 'success' : 'error');
    if (r.ok) onChanged();
  }

  async function save(confirmPast: boolean) {
    if (!scope || !proposed) return;
    setError(null);
    setSaving(true);
    const r = await api<{ undoId: number; note: string | null; trimmed?: unknown }>(
      `/api/admin/holiday-rules/${ruleId}/occurrence`,
      { method: 'POST', body: { year, startDate: start, endDate: end, scope, confirmPast } },
    );
    setSaving(false);
    if (r.ok) {
      const { undoId, note } = r.data;
      toast(`${h.title} changed.${note ? ` ${note}` : ''}`, 'success', {
        label: 'Undo',
        ms: UNDO_MS,
        onClick: () => void undo(undoId),
      });
      onChanged();
      return onClose();
    }
    if (r.code === 'PAST_CONFIRM') return setPastMsg(r.message);
    setError(r.status === 401 ? 'Your session expired. Please sign in again.' : r.message);
  }

  async function skip(confirmPast: boolean) {
    setError(null);
    setSaving(true);
    const r = await api(`/api/admin/holiday-rules/${ruleId}/overrides`, {
      method: 'PUT',
      body: { year, skipped: true, confirmPast },
    });
    setSaving(false);
    if (r.ok) {
      toast(`No ${h.title} in ${year}.`, 'success', {
        label: 'Undo',
        ms: UNDO_MS,
        onClick: () =>
          void api(`/api/admin/holiday-rules/${ruleId}/overrides`, {
            method: 'PUT',
            body: { year, skipped: false },
          }).then((u) => {
            toast(u.ok ? 'Change undone.' : u.message, u.ok ? 'success' : 'error');
            if (u.ok) onChanged();
          }),
      });
      onChanged();
      return onClose();
    }
    if (r.code === 'PAST_CONFIRM') return setPastMsg(r.message);
    setError(r.message);
  }

  if (history) {
    return <RuleHistory ruleId={ruleId} title={h.title} onClose={() => setHistory(false)} />;
  }

  const weekend = weekendRange(original, offDays);
  return (
    <Sheet title={h.title} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          <b>
            {weekday(h.startDate)} {dateRange(h.startDate, h.endDate)}
          </b>{' '}
          · Repeats every year
          {h.tentative && ' · Expected date'}
        </p>
        {weekend && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            With the weekend, students are off {weekend}.
          </p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Last changed by {h.updatedBy.name} · {stamp(h.updatedAt)}
        </p>

        {step === 'main' && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} onClick={() => setStep('change')}>
                Change date
              </button>
              <button type="button" className={`${small} py-2`} onClick={() => setStep('skip')}>
                No holiday this year
              </button>
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">More</summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={yearlyRuleHref(ruleId, year, 'edit')} className={small}>
                  Edit name or who is off
                </Link>
                <Link href={yearlyRuleHref(ruleId, year, 'end')} className={small}>
                  Stop repeating
                </Link>
                <button type="button" className={small} onClick={() => setHistory(true)}>
                  History
                </button>
              </div>
            </details>
          </>
        )}

        {step === 'skip' && (
          <div className="space-y-3">
            <p className="text-sm">
              Remove <b>{h.title}</b> from {year}? It will come back next year.
            </p>
            <ImpactPreview change={{ removeIds: [h.id] }} />
            {pastMsg ? (
              <PastConfirm
                message={pastMsg}
                busy={saving}
                onConfirm={() => void skip(true)}
                onCancel={() => setPastMsg(null)}
              />
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving}
                  className={primary}
                  onClick={() => void skip(false)}
                >
                  {saving ? 'Saving…' : `Remove for ${year}`}
                </button>
                <button type="button" className={`${small} py-2`} onClick={() => setStep('main')}>
                  Cancel
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        )}

        {step === 'change' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
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
                  onChange={(e) => setStart(e.target.value)}
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
            <TrimHint start={start} end={end} offDays={offDays} />

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Apply this change to</legend>
              {options.map((o) => (
                <label
                  key={o.scope}
                  className={`flex items-center gap-2 text-sm ${blocked(o.scope) ? 'opacity-50' : ''}`}
                >
                  <input
                    type="radio"
                    name="scope"
                    className="h-4 w-4 accent-indigo-600"
                    disabled={blocked(o.scope)}
                    checked={scope === o.scope}
                    onChange={() => setPicked(o.scope)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
            {why && (
              <p className="rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950 dark:text-sky-100">
                {why}
              </p>
            )}
            {plan?.ok && plan.pastEdit && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                This holiday is in the past. You will be asked to confirm before it is changed.
              </p>
            )}
            {plan?.ok && plan.note && <p className="text-sm">{plan.note}</p>}
            {scope === 'FROM_NEXT_YEAR' ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                This year&apos;s semesters do not change.
              </p>
            ) : (
              plan?.ok && (
                <ImpactPreview
                  change={{
                    removeIds: [h.id],
                    add: [{ ...plan.dates, audience: h.audience, title: h.title }],
                  }}
                />
              )
            )}

            {pastMsg && (
              <PastConfirm
                message={pastMsg}
                busy={saving}
                onConfirm={() => void save(true)}
                onCancel={() => setPastMsg(null)}
              />
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {error}
              </p>
            )}
            {!pastMsg && (
              <div className="flex gap-2">
                <button disabled={saving || !plan?.ok || unchanged} className={primary}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  className={`${small} py-2`}
                  onClick={() => setStep('main')}
                >
                  Cancel
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </Sheet>
  );
}

const RULE_ACTION: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Changed',
  DELETE: 'Removed',
};

function RuleHistory({
  ruleId,
  title,
  onClose,
}: {
  ruleId: number;
  title: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    api<{ entries: AuditEntry[] }>(`/api/admin/audit?ruleId=${ruleId}`).then((r) =>
      setEntries(r.ok ? r.data.entries : []),
    );
  }, [ruleId]);

  const what = (e: AuditEntry) => {
    const a = (e.after ?? {}) as {
      year?: number;
      startDate?: string;
      endDate?: string;
      skipped?: boolean;
    };
    if (e.entityType === 'RULE_OVERRIDE') {
      const y = a.year ? ` in ${a.year}` : '';
      if (a.skipped) return `Removed${y}`;
      if (a.startDate && a.endDate) return `Date${y} set to ${dateRange(a.startDate, a.endDate)}`;
      return `${RULE_ACTION[e.action] ?? 'Changed'} the yearly date${y}`;
    }
    return `${RULE_ACTION[e.action] ?? 'Changed'} the yearly rule`;
  };

  return (
    <Sheet title={`History: ${title}`} onClose={onClose}>
      {!entries ? (
        <p className="text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm">No changes yet.</p>
      ) : (
        <ol className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              <p className="font-medium">{what(e)}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {e.admin.name} · {stamp(e.at)}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
