import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatusBoard } from '@/components/StatusBoard';

export const metadata: Metadata = {
  title: 'Semester Status · RUET',
  description: 'Which semester stage every department and batch is in today.',
};

export default function StatusPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">Loading…</p>}>
      <StatusBoard />
    </Suspense>
  );
}
