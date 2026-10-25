import { Suspense } from 'react';
import { YearlyHolidays } from '@/components/YearlyHolidays';
import { parseOffDays } from '@/core/calendar/grid';

export default function YearlyPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading…</p>}>
      <YearlyHolidays offDays={parseOffDays(process.env.WEEKLY_OFF_DAYS)} />
    </Suspense>
  );
}
