'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayInDhaka } from '@/core/calendar/grid';
import { api, type Conflict } from '@/lib/api';
import type { BreakDeps, BreakQuestion } from '@/lib/break-save';
import { OverlapCard } from './OverlapLine';
import { PastConfirm } from './PastConfirm';

/**
 * Promise-based confirm for flows that write several things in a row (Series Board): `ask()`
 * shows the same overlap card / "Fix a past holiday" box as the calendar and resolves true when
 * the admin agrees. Render `node` somewhere inside the sheet.
 */
export function useBreakConfirm() {
  const [q, setQ] = useState<(BreakQuestion & { step: 'overlap' | 'past' }) | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const ask = useCallback(
    (query: BreakQuestion) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setQ({ ...query, step: query.conflicts.length > 0 ? 'overlap' : 'past' });
      }),
    [],
  );
  useEffect(() => {
    if (q) box.current?.scrollIntoView({ block: 'nearest' });
  }, [q]);

  const answer = (agreed: boolean) => {
    if (!q) return;
    if (agreed && q.step === 'overlap' && q.past) return setQ({ ...q, step: 'past' });
    resolver.current?.(agreed);
    resolver.current = null;
    setQ(null);
  };

  const node = q && (
    <div ref={box}>
      {q.step === 'overlap' ? (
        <OverlapCard
          conflicts={q.conflicts}
          onSaveAnyway={() => answer(true)}
          onCancel={() => answer(false)}
        />
      ) : (
        <PastConfirm
          message={q.past ?? ''}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      )}
    </div>
  );
  return { ask, node };
}

/** The real calls behind `gateBreak` / `postBreak`. */
export const breakDeps = (ask: BreakDeps['ask']): BreakDeps => ({
  today: todayInDhaka(),
  ask,
  check: async (range, audience) => {
    const r = await api<{ conflicts: Conflict[] }>('/api/admin/holidays/check-overlap', {
      method: 'POST',
      // title is required by the shared schema, irrelevant to overlap
      body: { title: 'check', ...range, audience },
    });
    // A failed check is not "no clash": the server still answers 409 on save and postBreak asks then.
    return r.ok ? r.data.conflicts : [];
  },
  post: (body) => api('/api/admin/holidays', { method: 'POST', body }),
});
