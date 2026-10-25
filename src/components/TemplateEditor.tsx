'use client';
import { DEFAULT_TEMPLATE, PHASES, type Template } from '@/core/semester/timeline';
import { bn } from '@/lib/rule-summary';
import { PHASE_BN } from '@/lib/semester-ui';
import { field, small } from './ui';

/** Edit the phase blocks of a semester: phase, number of weeks, and whether holidays extend it. */
export function TemplateEditor({
  value,
  onChange,
}: {
  value: Template;
  onChange: (t: Template) => void;
}) {
  const set = (i: number, patch: Partial<Template[number]>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const total = value.reduce((n, p) => n + p.weeks, 0);

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">ধাপ ও সপ্তাহ (মোট {bn(total)} সপ্তাহ)</legend>
      {value.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_4.5rem_auto_auto] items-end gap-2">
          <label className="block text-xs font-medium">
            ধাপ
            <select
              className={field}
              value={p.phase}
              onChange={(e) => set(i, { phase: e.target.value as Template[number]['phase'] })}
            >
              {PHASES.map((ph) => (
                <option key={ph} value={ph}>
                  {PHASE_BN[ph]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium">
            সপ্তাহ
            <input
              type="number"
              min={1}
              max={30}
              className={field}
              value={p.weeks}
              onChange={(e) => set(i, { weeks: Math.max(1, Number(e.target.value) || 1) })}
            />
          </label>
          <label
            className="flex items-center gap-1 pb-2 text-xs"
            title="ছুটির পুরো সপ্তাহ হলে ধাপ পিছিয়ে যাবে"
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-indigo-600"
              checked={p.extendable}
              onChange={(e) => set(i, { extendable: e.target.checked })}
            />
            বাড়ে
          </label>
          <button
            type="button"
            className={`${small} mb-0.5`}
            aria-label={`${i + 1} নম্বর ধাপ সরান`}
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={small}
          disabled={value.length >= 10}
          onClick={() => onChange([...value, { phase: 'CLASS', weeks: 1, extendable: true }])}
        >
          + ধাপ যোগ
        </button>
        <button type="button" className={small} onClick={() => onChange(DEFAULT_TEMPLATE)}>
          ডিফল্টে ফিরুন
        </button>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        “বাড়ে” চিহ্নিত ধাপে পুরো সপ্তাহ (শনি–বুধ) ছুটি পড়লে সেই সপ্তাহ গণনা হয় না, পরের সব কিছু
        এক সপ্তাহ পিছায়।
      </p>
    </fieldset>
  );
}
