import { redirect } from 'next/navigation';

// The yearly list now lives inside the admin calendar screen; keep old links working.
export default async function YearlyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year } = await searchParams;
  redirect(`/admin?tab=calendar&view=yearly${year ? `&year=${encodeURIComponent(year)}` : ''}`);
}
