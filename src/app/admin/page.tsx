import { AdminApp } from '@/components/AdminApp';
import { parseOffDays } from '@/core/calendar/grid';

export default function AdminPage() {
  return <AdminApp offDays={parseOffDays(process.env.WEEKLY_OFF_DAYS)} />;
}
