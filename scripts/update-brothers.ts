import { sql } from 'drizzle-orm';
import { departments, series } from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';

const data: Record<string, Record<number, number>> = {
  BECM: { 2021: 0, 2022: 4, 2023: 1, 2024: 2, 2025: 1 },
  CE:   { 2021: 6, 2022: 2, 2023: 9, 2024: 4, 2025: 1 },
  CME:  { 2021: 2, 2022: 4, 2023: 0, 2024: 2, 2025: 0 },
  CSE:  { 2021: 5, 2022: 1, 2023: 3, 2024: 3, 2025: 0 },
  ECE:  { 2021: 0, 2022: 1, 2023: 0, 2024: 3, 2025: 0 },
  EEE:  { 2021: 5, 2022: 1, 2023: 5, 2024: 4, 2025: 0 },
  ETE:  { 2021: 3, 2022: 0, 2023: 2, 2024: 0, 2025: 0 },
  IPE:  { 2021: 0, 2022: 1, 2023: 1, 2024: 1, 2025: 0 },
  ME:   { 2021: 2, 2022: 4, 2023: 6, 2024: 2, 2025: 0 },
  MSE:  { 2021: 1, 2022: 0, 2023: 0, 2024: 1, 2025: 0 },
  MTE:  { 2021: 2, 2022: 2, 2023: 0, 2024: 2, 2025: 0 },
  URP:  { 2021: 2, 2022: 0, 2023: 0, 2024: 0, 2025: 0 },
};

async function run() {
  const { db } = await connectAsOwner();
  const depts = await db.select().from(departments);
  const deptMap = new Map(depts.map((d) => [d.code.toUpperCase(), d.id]));

  let updated = 0;
  for (const [code, counts] of Object.entries(data)) {
    const deptId = deptMap.get(code.toUpperCase());
    if (!deptId) {
      console.warn(`Department ${code} not found!`);
      continue;
    }
    for (const [yearStr, count] of Object.entries(counts)) {
      const year = Number(yearStr);
      await db
        .update(series)
        .set({ brothersCount: count })
        .where(sql`${series.departmentId} = ${deptId} AND ${series.intakeYear} = ${year}`);
      updated++;
      console.log(`Updated ${code} intake ${year} -> ${count} brothers`);
    }
  }

  console.log(`Finished updating ${updated} series records.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
