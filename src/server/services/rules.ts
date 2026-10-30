import 'server-only';
import { and, asc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { compressAudience } from '@/core/calendar/compress';
import {
  activeInYear,
  expandRules,
  missingManualDates,
  planEdit,
  planEnd,
  resolveRuleYear,
  type Category,
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
    year,
    year + 1,
  );
  const bd = hijriBdOffset();
  const items = rules.map((r) => {
    const ov = overrides.find((o) => o.ruleId === r.id && o.year === year);
    const info = activeInYear(r, year) ? resolveRuleYear(r, year, ov, bd) : null;
    return {
      ...r,
      label: compressAudience(r.audience, structure),
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
    rules: missingManualDates(rules, overrides, y).map((r) => ({ id: r.id, title: r.title })),
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
  });
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
): Promise<Result<{ ruleId: number; trimmed?: { startDate: string; endDate: string } }>> {
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
  });
}

/** Remove one year's override (back to the computed dates). */
export async function clearOverride(
  adminId: number,
  ruleId: number,
  year: number,
): Promise<Result<{ ruleId: number }>> {
  return getDb().transaction(async (tx) => {
    await lockWrites(tx);
    const [prev] = await tx
      .select()
      .from(holidayRuleOverrides)
      .where(and(eq(holidayRuleOverrides.ruleId, ruleId), eq(holidayRuleOverrides.year, year)));
    if (!prev) return fail('NOT_FOUND', 'No override for that year.');
    await tx
      .delete(holidayRuleOverrides)
      .where(and(eq(holidayRuleOverrides.ruleId, ruleId), eq(holidayRuleOverrides.year, year)));
    await auditEntity(tx, adminId, 'DELETE', 'RULE_OVERRIDE', ruleId, prev, null);
    return ok({ ruleId });
  });
}
