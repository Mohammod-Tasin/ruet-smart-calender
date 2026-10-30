import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatusBoard } from '@/components/StatusBoard';

export const metadata: Metadata = {
  title: 'স্ট্যাটাস · RUET',
  description: 'কোন বিভাগ ও সিরিজ এখন সেমিস্টারের কোন ধাপে আছে।',
};

export default function StatusPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm">লোড হচ্ছে…</p>}>
      <StatusBoard />
    </Suspense>
  );
}
