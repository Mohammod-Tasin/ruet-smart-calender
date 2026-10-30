// New intake + graduation, by hand (no cron). Run from the project root:
//   npm run db:intake -- --year 2026       create that intake's series for every department
//   npm run db:intake -- --graduate        list series whose journey has ended (dry run)
//   npm run db:intake -- --graduate --apply   ... and mark them inactive
// Both flags can be combined. Needs DATABASE_URL (journeys are computed like the app does)
// and DATABASE_URL_OWNER (writes).
import { inArray } from 'drizzle-orm';
import { departments, series } from '../src/server/db/schema';
import { graduatedSeries } from '../src/server/services/journey';
import { connectAsOwner } from './lib/owner-db';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const yearArg = args.indexOf('--year') >= 0 ? Number(args[args.indexOf('--year') + 1]) : null;

async function main() {
  if (yearArg === null && !flag('--graduate')) {
    throw new Error('Nothing to do. Use --year <YYYY> and/or --graduate [--apply].');
  }
  const { db, pool } = connectAsOwner();
  try {
    if (yearArg !== null) {
      if (!Number.isInteger(yearArg) || yearArg < 2000 || yearArg > 2100) {
        throw new Error('--year must be a year between 2000 and 2100.');
      }
      const depts = await db.select({ id: departments.id }).from(departments);
      const rows = await db
        .insert(series)
        .values(depts.map((d) => ({ departmentId: d.id, intakeYear: yearArg })))
        .onConflictDoNothing()
        .returning({ id: series.id });
      console.log(
        `Intake ${yearArg}: ${rows.length} new series (${depts.length - rows.length} already existed).`,
      );
    }
    if (flag('--graduate')) {
      const done = await graduatedSeries();
      console.log(
        done.length
          ? `Graduated: ${done.map((s) => s.label).join(', ')}`
          : 'No series have graduated.',
      );
      if (done.length && flag('--apply')) {
        await db
          .update(series)
          .set({ isActive: false })
          .where(
            inArray(
              series.id,
              done.map((s) => s.id),
            ),
          );
        console.log(`Marked ${done.length} series inactive.`);
      } else if (done.length) console.log('Dry run. Add --apply to mark them inactive.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
