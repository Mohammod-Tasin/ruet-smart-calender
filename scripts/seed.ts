import { eq } from 'drizzle-orm';
import { departments, faculties, series } from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';

const ACTIVE_YEARS = [2021, 2022, 2023, 2024, 2025];

const SEED = [
  {
    code: 'ECE',
    name: 'Electrical & Computer Engineering',
    depts: [
      ['EEE', 'Electrical & Electronic Engineering'],
      ['CSE', 'Computer Science & Engineering'],
      ['ECE', 'Electronics & Communication Engineering'],
      ['ETE', 'Electrical & Telecommunication Engineering'],
    ],
  },
  {
    code: 'CE',
    name: 'Civil Engineering',
    depts: [
      ['CE', 'Civil Engineering'],
      ['ARCH', 'Architecture'],
      ['URP', 'Urban & Regional Planning'],
      ['BECM', 'Building Engineering & Construction Management'],
    ],
  },
  {
    code: 'ME',
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
