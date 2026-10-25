import { Suspense } from 'react';
import { YearlyHolidays } from '@/components/YearlyHolidays';

export default function YearlyPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading…</p>}>
      <YearlyHolidays />
    </Suspense>
  );
}
