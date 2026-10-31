import 'server-only';
import { and, asc, eq, gt, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { compressAudience, facultyName } from '@/core/calendar/compress';
import { todayInDhaka } from '@/core/calendar/grid';
import { pastMessage, planOccurrenceEdit, type EditScope } from '@/core/calendar/past';
import { hintedTitle, ruleMonthHints } from '@/core/calendar/rule-hint';
import {
  activeInYear,
  computeRuleDates,
  expandRules,
  missingManualDates,
  planEdit,
  patternParams,
  planEnd,
  resolveRuleYear,
  type Category,
  type RuleDates,
  type RuleDef,
  type RuleOccurrence,
  type RuleOverride,
  type RuleYear,
} from '@/core/calendar/rules';
import type { AudienceEntry } from '@/core/calendar/types';
import type { CreateRuleInput, OverrideInput, PatchRuleInput } from '@/core/validation/rules';
import { getDb, type Executor, type Tx } from '@/server/db/client';
import { getStructure } from '@/server/db/queries';
import {
  admins,
  auditLog,
  holidayRuleAudience,
  holidayRuleOverrides,
  holidayRules,
} from '@/server/db/schema';
import {
  audienceProblem,
  auditEntity,
  fail,
  lockWrites,
  ok,
  pastGate,
  type Person,
  type Result,
  ALL_WEEKLY_OFF,
  trimRange,
} from './shared';

/** Bangladesh usually sights the moon a day after Saudi Arabia. */
export const hijriBdOffset = () => {
  const n = Number.parseInt(process.env.HIJRI_BD_DAY_OFFSET ?? '', 10);
  return Number.isFinite(n) ? n : 1;
};

export interface RuleRecord extends RuleDef {
  createdBy: Person;
  updatedBy: Person;
  updatedAt: string;
}

interface OverrideRecord extends RuleOverride {
  updatedBy: Person;
  updatedAt: string;
}

// ---------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------

async function fetchRules(x: Executor, where?: SQL): Promise<RuleRecord[]> {
  const creator = alias(admins, 'creator');
  const updater = alias(admins, 'updater');
  const rows = await x
    .select({
      r: holidayRules,
      creatorName: creator.name,
      updaterName: updater.name,
    })
    .from(holidayRules)
    .innerJoin(creator, eq(creator.id, holidayRules.createdBy))
    .innerJoin(updater, eq(updater.id, holidayRules.updatedBy))
    .where(and(isNull(holidayRules.deletedAt), where))
    .orderBy(asc(holidayRules.id));
  if (rows.length === 0) return [];

  const audienceRows = await x
    .select()
    .from(holidayRuleAudience)
    .where(
      inArray(
        holidayRuleAudience.ruleId,
        rows.map((r) => r.r.id),
      ),
    );
  const byRule = new Map<number, AudienceEntry[]>();
  for (const a of audienceRows) {
    const list = byRule.get(a.ruleId) ?? [];
    list.push({ scopeType: a.scopeType, scopeId: a.scopeId });
    byRule.set(a.ruleId, list);
  }
  return rows.map(({ r, creatorName, updaterName }) => ({
    id: r.id,
    title: r.title,
    category: r.category as Category,
    classesOnly: r.classesOnly,
    audience: byRule.get(r.id) ?? [],
    params: r.params,
    effectiveFromYear: r.effectiveFromYear,
    effectiveToYear: r.effectiveToYear,
    createdBy: { id: r.createdBy, name: creatorName },
    updatedBy: { id: r.updatedBy, name: updaterName },
    updatedAt: r.updatedAt.toISOString(),
  }));
}

async function fetchOverrides(
  x: Executor,
  ruleIds: number[],
  y0: number,
  y1: number,
): Promise<OverrideRecord[]> {
  if (ruleIds.length === 0) return [];
  const rows = await x
    .select({ o: holidayRuleOverrides, updaterName: admins.name })
    .from(holidayRuleOverrides)
    .innerJoin(admins, eq(admins.id, holidayRuleOverrides.updatedBy))
    .where(
      and(
        inArray(holidayRuleOverrides.ruleId, ruleIds),
        gte(holidayRuleOverrides.year, y0),
        lte(holidayRuleOverrides.year, y1),
      ),
    );
  return rows.map(({ o, updaterName }) => ({
    ruleId: o.ruleId,
    year: o.year,
    startDate: o.startDate,
    endDate: o.endDate,
    skipped: o.skipped,
    confirmed: o.confirmed,
    note: o.note,
    updatedBy: { id: o.updatedBy, name: updaterName },
    updatedAt: o.updatedAt.toISOString(),
  }));
}

export interface RuleOccurrenceView extends RuleOccurrence {
  note: string | null;
  updatedBy: Person;
  updatedAt: string;
}

/** Yearly-rule occurrences touching [from, to], with who last changed them. */
export async function ruleOccurrences(
  x: Executor,
  range: { from: string; to: string },
): Promise<RuleOccurrenceView[]> {
  const y0 = Number(range.from.slice(0, 4)) - 1;
  const y1 = Number(range.to.slice(0, 4));
  const rules = await fetchRules(
    x,
    and(
      lte(holidayRules.effectiveFromYear, y1),
      or(isNull(holidayRules.effectiveToYear), gte(holidayRules.effectiveToYear, y0)),
    ),
  );
  const overrides = await fetchOverrides(
    x,
    rules.map((r) => r.id),
    y0,
    y1,
  );
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const overrideByKey = new Map(overrides.map((o) => [`${o.ruleId}:${o.year}`, o]));
  return expandRules(rules, overrides, range, hijriBdOffset()).map((o) => {
    const ov = overrideByKey.get(`${o.ruleId}:${o.year}`);
    const who = ov ?? ruleById.get(o.ruleId)!;
    return { ...o, note: ov?.note ?? null, updatedBy: who.updatedBy, updatedAt: who.updatedAt };
  });
}

export interface RuleYearView extends RuleYear {
  note: string | null;
  updatedBy: Person | null; // who set the override, if any
  updatedAt: string | null;
}

export interface RuleListItem extends RuleRecord {
  label: string;
  /** Month of the latest occurrence, only for rules that share a title with another rule. */
  hint: string | null;
  /** null when the rule is not active in the selected year */
  yearInfo: RuleYearView | null;
}

export interface DatesNeeded {
  year: number;
  rules: { id: number; title: string }[];
}

/** Everything the "Yearly holidays" page shows for `year`. */
export async function listRules(year: number): Promise<{
  year: number;
  bdOffset: number;
  rules: RuleListItem[];
  datesNeeded: DatesNeeded[];
}> {
  const db = getDb();
  const [rules, structure] = await Promise.all([fetchRules(db), getStructure(db)]);
  const overrides = await fetchOverrides(
    db,
    rules.map((r) => r.id),
    year - 10,
    year + 1,
  );
  const bd = hijriBdOffset();
  const hints = ruleMonthHints(rules, overrides, year, bd);
  const items = rules.map((r) => {
    const ov = overrides.find((o) => o.ruleId === r.id && o.year === year);
    const info = activeInYear(r, year) ? resolveRuleYear(r, year, ov, bd) : null;
    return {
      ...r,
      hint: hints.get(r.id) ?? null,
      label: compressAudience(r.audience, structure, facultyName),
      yearInfo: info && {
        ...info,
        note: ov?.note ?? null,
        updatedBy: ov?.updatedBy ?? null,
        updatedAt: ov?.updatedAt ?? null,
      },
    };
  });
  const datesNeeded = [year, year + 1].map((y) => ({
    year: y,
    rules: missingManualDates(rules, overrides, y).map((r) => ({
      id: r.id,
      title: hintedTitle(r.title, hints.get(r.id)),
    })),
  }));
  return { year, bdOffset: bd, rules: items, datesNeeded };
}

// ---------------------------------------------------------------------------------------
// Writing (always: lock, write, audit, in one transaction)
// ---------------------------------------------------------------------------------------

const snapshot = (r: RuleDef & { deletedAt?: string | null }) => ({
  title: r.title,
  category: r.category,
  classesOnly: r.classesOnly,
  params: r.params,
  audience: r.audience,
  effectiveFromYear: r.effectiveFromYear,
  effectiveToYear: r.effectiveToYear,
});

const insertAudience = (tx: Tx, ruleId: number, audience: AudienceEntry[]) =>
  tx.insert(holidayRuleAudience).values(audience.map((a) => ({ ruleId, ...a })));

async function insertRule(tx: Tx, adminId: number, r: Omit<RuleDef, 'id'>): Promise<number> {
  const [row] = await tx
    .insert(holidayRules)
    .values({
      title: r.title,
      category: r.category,
      classesOnly: r.classesOnly,
      kind: r.params.kind,
      params: r.params,
      effectiveFromYear: r.effectiveFromYear,
      effectiveToYear: r.effectiveToYear,
      createdBy: adminId,
      updatedBy: adminId,
    })
    .returning({ id: holidayRules.id });
  await insertAudience(tx, row!.id, r.audience);
  return row!.id;
}

async function oneRule(x: Executor, id: number) {
  return (await fetchRules(x, eq(holidayRules.id, id)))[0] ?? null;
}

export async function createRule(
  adminId: number,
  input: CreateRuleInput,
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const problem = await audienceProblem(tx, await getStructure(tx), input.audience);
    if (problem) return fail('UNPROCESSABLE', problem);

    const def = { ...input, effectiveToYear: null };
    const ruleId = await insertRule(tx, adminId, def);
    await auditEntity(
      tx,
      adminId,
      'CREATE',
      'RULE',
      ruleId,
      null,
      snapshot({ id: ruleId, ...def }),
    );
    return ok({ ruleId });
  });
}

/** Edit "from year onward". Past years keep the old rule; see planEdit. */
export async function updateRule(
  adminId: number,
  id: number,
  patch: PatchRuleInput,
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    return applyRuleEdit(tx, adminId, id, patch);
  });
}

/** The body of updateRule; the caller already holds the write lock inside a transaction. */
async function applyRuleEdit(
  tx: Tx,
  adminId: number,
  id: number,
  patch: PatchRuleInput,
): Promise<Result<{ ruleId: number }>> {
  {
    const existing = await oneRule(tx, id);
    if (!existing) return fail('NOT_FOUND', 'Rule not found.');
    const { fromYear, ...fields } = patch;
    if (existing.effectiveToYear !== null && fromYear > existing.effectiveToYear) {
      return fail('BAD_REQUEST', `This rule already ended in ${existing.effectiveToYear}.`);
    }
    if (patch.audience) {
      const problem = await audienceProblem(tx, await getStructure(tx), patch.audience);
      if (problem) return fail('UNPROCESSABLE', problem);
    }

    const merged: RuleDef = {
      ...existing,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    };
    const plan = planEdit(existing, fromYear);

    if (plan.mode === 'IN_PLACE') {
      await tx
        .update(holidayRules)
        .set({
          title: merged.title,
          category: merged.category,
          classesOnly: merged.classesOnly,
          kind: merged.params.kind,
          params: merged.params,
          updatedBy: adminId,
          updatedAt: sql`now()`,
        })
        .where(eq(holidayRules.id, id));
      if (patch.audience) {
        await tx.delete(holidayRuleAudience).where(eq(holidayRuleAudience.ruleId, id));
        await insertAudience(tx, id, patch.audience);
      }
      await auditEntity(tx, adminId, 'UPDATE', 'RULE', id, snapshot(existing), snapshot(merged));
      return ok({ ruleId: id });
    }

    await tx
      .update(holidayRules)
      .set({ effectiveToYear: plan.oldEffectiveTo, updatedBy: adminId, updatedAt: sql`now()` })
      .where(eq(holidayRules.id, id));
    const newId = await insertRule(tx, adminId, { ...merged, effectiveFromYear: fromYear });
    // Per-year overrides for the new rule's years follow it; earlier years stay with the old rule.
    await tx
      .update(holidayRuleOverrides)
      .set({ ruleId: newId })
      .where(and(eq(holidayRuleOverrides.ruleId, id), gte(holidayRuleOverrides.year, fromYear)));
    await auditEntity(tx, adminId, 'UPDATE', 'RULE', id, snapshot(existing), {
      ...snapshot(existing),
      effectiveToYear: plan.oldEffectiveTo,
    });
    await auditEntity(
      tx,
      adminId,
      'CREATE',
      'RULE',
      newId,
      null,
      snapshot({ ...merged, id: newId, effectiveFromYear: fromYear }),
    );
    return ok({ ruleId: newId });
  }
}

/** End "from year onward". */
export async function endRule(
  adminId: number,
  id: number,
  fromYear: number,
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const existing = await oneRule(tx, id);
    if (!existing) return fail('NOT_FOUND', 'Rule not found.');
    if (existing.effectiveToYear !== null && fromYear > existing.effectiveToYear) {
      return fail('BAD_REQUEST', `This rule already ended in ${existing.effectiveToYear}.`);
    }
    const plan = planEnd(existing, fromYear);
    if (plan.mode === 'SOFT_DELETE') {
      await tx
        .update(holidayRules)
        .set({ deletedAt: sql`now()`, updatedBy: adminId, updatedAt: sql`now()` })
        .where(eq(holidayRules.id, id));
      await auditEntity(tx, adminId, 'DELETE', 'RULE', id, snapshot(existing), null);
    } else {
      await tx
        .update(holidayRules)
        .set({ effectiveToYear: plan.effectiveTo, updatedBy: adminId, updatedAt: sql`now()` })
        .where(eq(holidayRules.id, id));
      await auditEntity(tx, adminId, 'UPDATE', 'RULE', id, snapshot(existing), {
        ...snapshot(existing),
        effectiveToYear: plan.effectiveTo,
      });
    }
    return ok({ ruleId: id });
  });
}

/** Create or change one year's override. Fields left out keep their current value. */
export async function setOverride(
  adminId: number,
  ruleId: number,
  raw: OverrideInput,
  today: string = todayInDhaka(),
): Promise<
  Result<{ ruleId: number; trimmed?: { startDate: string; endDate: string }; note?: string }>
> {
  let input = raw;
  let trimmed: { startDate: string; endDate: string } | undefined;
  if (raw.startDate && raw.endDate) {
    const t = trimRange({ startDate: raw.startDate, endDate: raw.endDate });
    if (!t) return fail('UNPROCESSABLE', ALL_WEEKLY_OFF);
    if (t.trimmed) {
      trimmed = { startDate: t.startDate, endDate: t.endDate };
      input = { ...raw, ...trimmed };
    }
  }
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const rule = await oneRule(tx, ruleId);
    if (!rule) return fail('NOT_FOUND', 'Rule not found.');
    if (!activeInYear(rule, input.year)) {
      return fail('BAD_REQUEST', `This rule is not active in ${input.year}.`);
    }
    const [prev] = await tx
      .select()
      .from(holidayRuleOverrides)
      .where(
        and(eq(holidayRuleOverrides.ruleId, ruleId), eq(holidayRuleOverrides.year, input.year)),
      );

    // Same time rules as the occurrence editor, so no route can rewrite the past around them.
    let clipNote: string | null = null;
    const current = resolveRuleYear(
      rule,
      input.year,
      prev && toOverride(prev),
      hijriBdOffset(),
    ).final;
    const structure = await getStructure(tx);
    const gate = (ranges: (RuleDates | null)[]) =>
      pastGate(tx, structure, {
        today,
        ranges,
        audiences: [rule.audience],
        confirmed: input.confirmPast,
      });
    if (input.startDate && input.endDate) {
      const proposed = { startDate: input.startDate, endDate: input.endDate };
      const changes =
        !current ||
        current.startDate !== proposed.startDate ||
        current.endDate !== proposed.endDate;
      if (changes && current) {
        const plan = planOccurrenceEdit({
          today,
          year: input.year,
          ruleKind: rule.params.kind,
          original: current,
          proposed,
          scope: 'ONLY_YEAR',
          confirmPast: !!input.confirmPast,
        });
        if (!plan.ok) {
          if (plan.code === 'UNPROCESSABLE') return fail('UNPROCESSABLE', plan.message);
          return (await gate([current])) ?? fail('PAST_CONFIRM', pastMessage(0));
        }
        input = { ...input, ...plan.dates };
        clipNote = plan.note;
      } else if (changes) {
        const blocked = await gate([proposed]); // first dates of a manual holiday
        if (blocked) return blocked;
      }
    } else if (input.skipped && !prev?.skipped && current) {
      const blocked = await gate([current]);
      if (blocked) return blocked;
    }

    const r = await writeOverride(tx, adminId, ruleId, input, prev, trimmed);
    return r.ok && clipNote ? ok({ ...r.value, note: clipNote }) : r;
  });
}

const toOverride = (o: typeof holidayRuleOverrides.$inferSelect): RuleOverride => ({
  ruleId: o.ruleId,
  year: o.year,
  startDate: o.startDate,
  endDate: o.endDate,
  skipped: o.skipped,
  confirmed: o.confirmed,
  note: o.note,
});

async function writeOverride(
  tx: Tx,
  adminId: number,
  ruleId: number,
  input: OverrideInput,
  prev: typeof holidayRuleOverrides.$inferSelect | undefined,
  trimmed?: { startDate: string; endDate: string },
): Promise<Result<{ ruleId: number; trimmed?: { startDate: string; endDate: string } }>> {
  const next = {
    startDate: input.startDate !== undefined ? input.startDate : (prev?.startDate ?? null),
    endDate: input.endDate !== undefined ? input.endDate : (prev?.endDate ?? null),
    skipped: input.skipped ?? prev?.skipped ?? false,
    confirmed: input.confirmed ?? prev?.confirmed ?? false,
    note: input.note !== undefined ? input.note : (prev?.note ?? null),
  };
  await tx
    .insert(holidayRuleOverrides)
    .values({ ruleId, year: input.year, ...next, updatedBy: adminId })
    .onConflictDoUpdate({
      target: [holidayRuleOverrides.ruleId, holidayRuleOverrides.year],
      set: { ...next, updatedBy: adminId, updatedAt: sql`now()` },
    });
  const pick = (o: typeof next | undefined) => o && { year: input.year, ...o };
  await auditEntity(
    tx,
    adminId,
    prev ? 'UPDATE' : 'CREATE',
    'RULE_OVERRIDE',
    ruleId,
    pick(prev),
    pick(next),
  );
  return ok({ ruleId, trimmed });
}

/** Remove one year's override (back to the computed dates). */
export async function clearOverride(
  adminId: number,
  ruleId: number,
  year: number,
  opts: { confirmPast?: boolean; today?: string } = {},
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [prev] = await tx
      .select()
      .from(holidayRuleOverrides)
      .where(and(eq(holidayRuleOverrides.ruleId, ruleId), eq(holidayRuleOverrides.year, year)));
    if (!prev) return fail('NOT_FOUND', 'No override for that year.');
    // Going back to the computed dates moves the occurrence: same past protection as any edit.
    const rule = await oneRule(tx, ruleId);
    if (rule) {
      const bd = hijriBdOffset();
      const now = resolveRuleYear(rule, year, toOverride(prev), bd).final;
      const back = resolveRuleYear(rule, year, undefined, bd).final;
      const moves = now?.startDate !== back?.startDate || now?.endDate !== back?.endDate;
      const blocked = moves
        ? await pastGate(tx, await getStructure(tx), {
            today: opts.today,
            ranges: [now, back],
            audiences: [rule.audience],
            confirmed: opts.confirmPast,
          })
        : null;
      if (blocked) return blocked;
    }
    await tx
      .delete(holidayRuleOverrides)
      .where(and(eq(holidayRuleOverrides.ruleId, ruleId), eq(holidayRuleOverrides.year, year)));
    await auditEntity(tx, adminId, 'DELETE', 'RULE_OVERRIDE', ruleId, prev, null);
    return ok({ ruleId });
  });
}

// ---------------------------------------------------------------------------------------
// Edit one yearly occurrence from the calendar (+ undo)
// ---------------------------------------------------------------------------------------

export interface OccurrenceInput {
  year: number;
  startDate: string;
  endDate: string;
  scope: EditScope;
  confirmPast?: boolean;
}

interface EditSnapshot {
  rule: ReturnType<typeof snapshot> & { id: number };
  overrides: (RuleOverride & { updatedBy: number })[];
}

/**
 * "Change date" on a yearly holiday: only this year (an override), or a new rule version from
 * this year / next year. The time rules (core/calendar/past.ts) are enforced here, inside the
 * write transaction. Returns `undoId`: a snapshot taken before the change, so undoRuleEdit can
 * put everything back exactly.
 */
export async function changeOccurrence(
  adminId: number,
  ruleId: number,
  raw: OccurrenceInput,
  today: string = todayInDhaka(),
): Promise<
  Result<{
    ruleId: number;
    undoId: number;
    dates: RuleDates;
    trimmed?: RuleDates;
    note: string | null;
  }>
> {
  const t = trimRange({ startDate: raw.startDate, endDate: raw.endDate });
  if (!t) return fail('UNPROCESSABLE', ALL_WEEKLY_OFF);
  const proposed = { startDate: t.startDate, endDate: t.endDate };

  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const rule = await oneRule(tx, ruleId);
    if (!rule) return fail('NOT_FOUND', 'Rule not found.');
    const { year } = raw;
    if (!activeInYear(rule, year))
      return fail('BAD_REQUEST', `This rule is not active in ${year}.`);

    const ovRows = await tx
      .select()
      .from(holidayRuleOverrides)
      .where(eq(holidayRuleOverrides.ruleId, ruleId));
    const prev = ovRows.find((o) => o.year === year);
    const bd = hijriBdOffset();
    const original = resolveRuleYear(rule, year, prev && toOverride(prev), bd).final;
    if (!original) return fail('UNPROCESSABLE', `This holiday has no dates in ${year}.`);

    const plan = planOccurrenceEdit({
      today,
      year,
      ruleKind: rule.params.kind,
      original,
      proposed,
      scope: raw.scope,
      confirmPast: !!raw.confirmPast,
    });
    if (!plan.ok) {
      if (plan.code === 'UNPROCESSABLE') return fail('UNPROCESSABLE', plan.message);
      const gate = await pastGate(tx, await getStructure(tx), {
        today,
        ranges: [original],
        audiences: [rule.audience],
      });
      return gate ?? fail('PAST_CONFIRM', pastMessage(0));
    }

    const before: EditSnapshot = {
      rule: { id: ruleId, ...snapshot(rule) },
      overrides: ovRows.map((o) => ({ ...toOverride(o), updatedBy: o.updatedBy })),
    };
    let resultId = ruleId;
    const created: number[] = [];

    if (raw.scope === 'ONLY_YEAR') {
      const r = await writeOverride(tx, adminId, ruleId, { year, ...plan.dates }, prev);
      if (!r.ok) return r;
    } else {
      const computed = computeRuleDates(rule.params, year, bd);
      const shifted = patternParams(rule.params, computed, plan.pattern);
      if (!shifted.ok) return fail('UNPROCESSABLE', shifted.message);
      const fromYear = raw.scope === 'FROM_YEAR' ? year : year + 1;
      const edited = await applyRuleEdit(tx, adminId, ruleId, { fromYear, params: shifted.params });
      if (!edited.ok) return edited;
      resultId = edited.value.ruleId;
      if (resultId !== ruleId) created.push(resultId);
      if (raw.scope === 'FROM_YEAR') {
        // This year's dates now come from the new pattern; drop the old moved dates (keep confirm/skip).
        const [ov] = await tx
          .select()
          .from(holidayRuleOverrides)
          .where(
            and(eq(holidayRuleOverrides.ruleId, resultId), eq(holidayRuleOverrides.year, year)),
          );
        if (ov?.startDate) {
          await writeOverride(tx, adminId, resultId, { year, startDate: null, endDate: null }, ov);
        }
      }
    }

    const [mark] = await tx
      .insert(auditLog)
      .values({
        adminId,
        action: 'UPDATE',
        entityType: 'RULE_EDIT',
        entityId: ruleId,
        before,
        after: { scope: raw.scope, year, createdRuleIds: created, dates: plan.dates },
      })
      .returning({ id: auditLog.id });
    return ok({
      ruleId: resultId,
      undoId: mark!.id,
      dates: plan.dates,
      trimmed: t.trimmed ? proposed : undefined,
      note: plan.note,
    });
  });
}

/**
 * Reverts one changeOccurrence from its snapshot. Refused (409) when the same rule was changed
 * again since, or when it was already undone, so an undo can never overwrite newer work.
 */
export async function undoRuleEdit(
  adminId: number,
  undoId: number,
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [mark] = await tx
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.id, undoId),
          eq(auditLog.entityType, 'RULE_EDIT'),
          eq(auditLog.action, 'UPDATE'),
        ),
      );
    if (!mark) return fail('NOT_FOUND', 'Nothing to undo.');
    const snap = mark.before as EditSnapshot;
    const created = (mark.after as { createdRuleIds: number[] }).createdRuleIds;
    const involved = [snap.rule.id, ...created];

    const [done] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'RULE_EDIT'),
          eq(auditLog.action, 'DELETE'),
          sql`${auditLog.before}->>'undoId' = ${String(undoId)}`,
        ),
      );
    if (done) return fail('CONFLICT', 'That change was already undone.');
    const [later] = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          gt(auditLog.id, undoId),
          inArray(auditLog.entityType, ['RULE', 'RULE_OVERRIDE']),
          inArray(auditLog.entityId, involved),
        ),
      )
      .limit(1);
    if (later) {
      return fail('CONFLICT', 'This holiday was changed again, so this change cannot be undone.');
    }

    for (const id of created) {
      await tx
        .update(holidayRules)
        .set({ deletedAt: sql`now()`, updatedBy: adminId, updatedAt: sql`now()` })
        .where(eq(holidayRules.id, id));
      await auditEntity(tx, adminId, 'DELETE', 'RULE', id, null, null);
    }
    const r = snap.rule;
    await tx
      .update(holidayRules)
      .set({
        title: r.title,
        category: r.category,
        classesOnly: r.classesOnly,
        kind: r.params.kind,
        params: r.params,
        effectiveFromYear: r.effectiveFromYear,
        effectiveToYear: r.effectiveToYear,
        updatedBy: adminId,
        updatedAt: sql`now()`,
      })
      .where(eq(holidayRules.id, r.id));
    await tx.delete(holidayRuleOverrides).where(inArray(holidayRuleOverrides.ruleId, involved));
    if (snap.overrides.length) {
      await tx.insert(holidayRuleOverrides).values(snap.overrides);
    }
    await auditEntity(tx, adminId, 'UPDATE', 'RULE', r.id, null, r);
    await tx.insert(auditLog).values({
      adminId,
      action: 'DELETE',
      entityType: 'RULE_EDIT',
      entityId: snap.rule.id,
      before: { undoId },
      after: null,
    });
    return ok({ ruleId: r.id });
  });
}
