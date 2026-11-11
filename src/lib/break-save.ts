import { needsPastConfirm } from '@/core/calendar/past';
import type { AudienceEntry } from '@/core/calendar/types';
import type { Conflict } from '@/lib/api';

// Saving an Unofficial Break from the Series Board: look first, ask only if there is something to
// ask about, and send a confirm flag only for what the admin agreed to. The server still enforces
// both rules; this just keeps the admin from being surprised (and from half-applied edits).

export interface BreakRange {
  startDate: string;
  endDate: string;
}
export interface BreakFlags {
  confirmOverlap?: boolean;
  confirmPast?: boolean;
}
export interface BreakQuestion {
  conflicts: Conflict[];
  /** Warning text when the break starts in the past, else null. */
  past: string | null;
}
type Reply = { ok: true } | { ok: false; code: string; message: string; conflicts?: Conflict[] };

export interface BreakDeps {
  /** Today in Asia/Dhaka. */
  today: string;
  check: (range: BreakRange, audience: AudienceEntry[]) => Promise<Conflict[]>;
  post: (body: Record<string, unknown>) => Promise<Reply>;
  /** Shows the overlap card / "Fix a past holiday" confirm; true = the admin agreed. */
  ask: (q: BreakQuestion) => Promise<boolean>;
}

export const PAST_BREAK_MESSAGE =
  'This break starts in the past. Saving it recalculates the semester history of the selected series.';

/**
 * Pre-check, before anything is written. null = the admin cancelled. Otherwise the flags to send:
 * empty when nothing was found (so nothing is confirmed that nobody looked at).
 */
export async function gateBreak(
  range: BreakRange,
  audience: AudienceEntry[],
  deps: BreakDeps,
): Promise<BreakFlags | null> {
  const [conflicts, past] = [
    await deps.check(range, audience),
    needsPastConfirm(deps.today, [range]) ? PAST_BREAK_MESSAGE : null,
  ];
  if (conflicts.length === 0 && !past) return {};
  if (!(await deps.ask({ conflicts, past }))) return null;
  return {
    confirmOverlap: conflicts.length > 0 ? true : undefined,
    confirmPast: past ? true : undefined,
  };
}

/**
 * Posts the break with exactly the agreed flags. If the server still answers OVERLAP or
 * PAST_CONFIRM (it knows more than the pre-check, e.g. a clash created a moment ago), ask once
 * more and resend with that flag added.
 */
export async function postBreak(
  base: Record<string, unknown>,
  flags: BreakFlags,
  deps: BreakDeps,
): Promise<{ ok: true } | { ok: false; cancelled: boolean; message: string }> {
  let sent = flags;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await deps.post({ ...base, ...sent });
    if (r.ok) return { ok: true };
    const overlap = r.code === 'OVERLAP' && !sent.confirmOverlap;
    const past = r.code === 'PAST_CONFIRM' && !sent.confirmPast;
    if (!overlap && !past) return { ok: false, cancelled: false, message: r.message };
    const agreed = await deps.ask({
      conflicts: overlap ? (r.conflicts ?? []) : [],
      past: past ? r.message : null,
    });
    if (!agreed)
      return { ok: false, cancelled: true, message: 'Cancelled. The break was not added.' };
    sent = {
      ...sent,
      ...(overlap ? { confirmOverlap: true } : {}),
      ...(past ? { confirmPast: true } : {}),
    };
  }
  return { ok: false, cancelled: false, message: 'Could not save the break.' };
}
