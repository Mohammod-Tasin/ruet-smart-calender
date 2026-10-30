import { Suspense } from 'react';
import { AdminApp } from '@/components/AdminApp';
import { parseOffDays } from '@/core/calendar/grid';

export default function AdminPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading…</p>}>
      <AdminApp offDays={parseOffDays(process.env.WEEKLY_OFF_DAYS)} />
    </Suspense>
  );
}
