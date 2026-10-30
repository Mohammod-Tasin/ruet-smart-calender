import { asc, eq } from 'drizzle-orm';
import { SEED_RULES } from '../src/core/calendar/seed-rules';
import {
  admins,
  departments,
  faculties,
  holidayRuleAudience,
  holidayRuleOverrides,
  holidayRules,
  series,
} from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';

const ACTIVE_YEARS = [2021, 2022, 2023, 2024, 2025];

const SEED = [
  {
    code: 'FECE',
    name: 'Electrical & Computer Engineering',
    depts: [
      ['EEE', 'Electrical & Electronic Engineering'],
      ['CSE', 'Computer Science & Engineering'],
      ['ECE', 'Electronics & Communication Engineering'],
      ['ETE', 'Electrical & Telecommunication Engineering'],
    ],
  },
  {
    code: 'FCE',
    name: 'Civil Engineering',
    depts: [
      ['CE', 'Civil Engineering'],
      ['ARCH', 'Architecture'],
      ['URP', 'Urban & Regional Planning'],
      ['BECM', 'Building Engineering & Construction Management'],
    ],
  },
  {
    code: 'FME',
    name: 'Mechanical Engineering',
    depts: [
      ['ME', 'Mechanical Engineering'],
      ['IPE', 'Industrial & Production Engineering'],
      ['CME', 'Ceramic & Metallurgical Engineering'],
      ['MTE', 'Mechatronics Engineering'],
      ['MSE', 'Materials Science & Engineering'],
      ['ChE', 'Chemical Engineering'],
    ],
  },
] as const;

/** The 2026 yearly holidays. Only when there are no rules yet, so admin edits are never undone. */
async function seedRules(db: ReturnType<typeof connectAsOwner>['db']) {
  if ((await db.$count(holidayRules)) > 0) return console.log('Rules already present: skipped.');
  const [admin] = await db.select().from(admins).orderBy(asc(admins.id)).limit(1);
  if (!admin) {
    return console.log('No admin yet: run `npm run db:create-admin`, then seed again for rules.');
  }
  for (const r of SEED_RULES) {
    const [row] = await db
      .insert(holidayRules)
      .values({
        title: r.title,
        classesOnly: r.classesOnly ?? false,
        kind: r.params.kind,
        params: r.params,
        effectiveFromYear: 2026,
        createdBy: admin.id,
        updatedBy: admin.id,
      })
      .returning({ id: holidayRules.id });
    await db
      .insert(holidayRuleAudience)
      .values({ ruleId: row!.id, scopeType: 'ALL', scopeId: null });
    if (r.y2026) {
      await db.insert(holidayRuleOverrides).values({
        ruleId: row!.id,
        year: 2026,
        ...r.y2026,
        confirmed: r.params.kind === 'HIJRI',
        updatedBy: admin.id,
      });
    }
  }
  console.log(`Seeded ${SEED_RULES.length} yearly holiday rules (with 2026 dates).`);
}

async function main() {
  const { db, pool } = connectAsOwner();
  try {
    // Idempotent: unique constraints + ON CONFLICT DO NOTHING make re-runs safe.
    for (const [i, f] of SEED.entries()) {
      await db
        .insert(faculties)
        .values({ code: f.code, name: f.name, sortOrder: i + 1 })
        .onConflictDoNothing();
      const [fac] = await db.select().from(faculties).where(eq(faculties.code, f.code));
      if (!fac) throw new Error(`faculty ${f.code} missing`);

      for (const [code, name] of f.depts) {
        await db
          .insert(departments)
          .values({ facultyId: fac.id, code, name })
          .onConflictDoNothing();
        const [dept] = await db.select().from(departments).where(eq(departments.code, code));
        if (!dept) throw new Error(`department ${code} missing`);
        await db
          .insert(series)
          .values(ACTIVE_YEARS.map((intakeYear) => ({ departmentId: dept.id, intakeYear })))
          .onConflictDoNothing();
      }
    }
    await seedRules(db);
    const [f, d, s] = await Promise.all([
      db.$count(faculties),
      db.$count(departments),
      db.$count(series),
    ]);
    console.log(`Seeded: ${f} faculties, ${d} departments, ${s} series.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
