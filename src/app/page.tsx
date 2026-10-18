import { Suspense } from 'react';
import { parseOffDays } from '@/core/calendar/grid';
import { PublicCalendar } from '@/components/PublicCalendar';

export default function Home() {
  const offDays = parseOffDays(process.env.WEEKLY_OFF_DAYS);
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading calendar…</p>}>
      <PublicCalendar offDays={offDays} />
    </Suspense>
  );
}
