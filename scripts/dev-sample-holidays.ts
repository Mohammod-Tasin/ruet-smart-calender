// TEMPORARY dev helper (delete in Phase 5 when real admin writes exist).
// Inserts/removes 3 "[SAMPLE]" holidays in the current month. Skips audit_log on purpose.
import { asc, eq, like } from 'drizzle-orm';
import { admins, departments, holidayAudience, holidays, series } from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';

const PREFIX = '[SAMPLE]';

async function main() {
  const remove = process.argv.includes('--remove');
  const { db, pool } = connectAsOwner();
  try {
    await db.delete(holidays).where(like(holidays.title, `${PREFIX}%`)); // audience cascades
    if (remove) return console.log('Removed sample holidays.');

    const [admin] = await db
      .select()
      .from(admins)
      .where(eq(admins.role, 'SUPER_ADMIN'))
      .orderBy(asc(admins.id))
      .limit(1);
    if (!admin) throw new Error('No SUPER_ADMIN found. Run `npm run db:create-admin` first.');

    const deptId = async (code: string) => {
      const [d] = await db.select().from(departments).where(eq(departments.code, code));
      if (!d) throw new Error(`department ${code} not found (run db:seed)`);
      return d.id;
    };
    const seriesId = async (code: string, year: number) => {
      const all = await db
        .select()
        .from(series)
        .where(eq(series.departmentId, await deptId(code)));
      const hit = all.find((x) => x.intakeYear === year);
      if (!hit) throw new Error(`series ${code}-${year} not found`);
      return hit.id;
    };

    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const day = (d: number) => `${ym}-${String(d).padStart(2, '0')}`;

    const samples = [
      {
        title: `${PREFIX} Eid break (whole university)`,
        startDate: day(10),
        endDate: day(12),
        audience: [{ scopeType: 'ALL' as const, scopeId: null }],
      },
      {
        title: `${PREFIX} CSE & EEE study tour`,
        startDate: day(15),
        endDate: day(15),
        audience: [
          { scopeType: 'DEPARTMENT' as const, scopeId: await deptId('CSE') },
          { scopeType: 'DEPARTMENT' as const, scopeId: await deptId('EEE') },
        ],
      },
      {
        title: `${PREFIX} CSE-23 and ME-22 program`,
        startDate: day(20),
        endDate: day(21),
        audience: [
          { scopeType: 'SERIES' as const, scopeId: await seriesId('CSE', 2023) },
          { scopeType: 'SERIES' as const, scopeId: await seriesId('ME', 2022) },
        ],
      },
    ];

    for (const { audience, ...h } of samples) {
      const [row] = await db
        .insert(holidays)
        .values({ ...h, createdBy: admin.id })
        .returning({ id: holidays.id });
      await db.insert(holidayAudience).values(audience.map((a) => ({ holidayId: row!.id, ...a })));
    }
    console.log(`Inserted 3 sample holidays in ${ym}.`);
    console.log(`Try: /api/holidays?from=${ym}-01&to=${ym}-28`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
