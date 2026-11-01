'use client';
import { useEffect, useState } from 'react';
import { DEFAULT_STRUCTURE, type JourneyStructure } from '@/core/journey/journey';
import {
  fieldsFromStructure,
  structureFromFields,
  type ScheduleFields,
} from '@/core/journey/schedule';
import { api } from '@/lib/api';
import { AdminHome } from './AdminHome';
import { ScheduleForm } from './ScheduleForm';
import { useToast } from './Toast';
import { YearlyHolidays } from './YearlyHolidays';

/**
 * Admin Settings tab:
 * 1. Permanent & Yearly Holidays (Fixed dates every year, Moon-based, and Yearly Manual holidays)
 * 2. Default Semester Schedule Settings (University-wide default weeks for Class, Board Viva, Final)
 * 3. Pending Semester Reminders / Checks
 */
export function AdminSettings() {
  const toast = useToast();
  const [defaults, setDefaults] = useState<ScheduleFields | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);

  useEffect(() => {
    api<{ structure: JourneyStructure }>('/api/admin/academic-settings').then((r) => {
      const f = r.ok ? fieldsFromStructure(r.data.structure) : null;
      setDefaults(f ?? fieldsFromStructure(DEFAULT_STRUCTURE)!);
    });
  }, []);

  async function saveDefaultSchedule(fields: ScheduleFields) {
    setSavingDefaults(true);
    const r = await api('/api/admin/academic-settings', {
      method: 'PUT',
      body: { structure: structureFromFields(fields) },
    });
    setSavingDefaults(false);
    if (!r.ok) return toast(r.message, 'error');
    setDefaults(fields);
    toast('Default semester schedule saved.');
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Permanent & Yearly Holidays */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <YearlyHolidays />
      </section>

      {/* Section 2: Default Semester Schedule Settings */}
      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-bold">Default Semester Schedule</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Standard semester duration used for all batches unless a custom schedule is set for a
            specific semester.
          </p>
        </div>
        {!defaults ? (
          <p className="text-sm">Loading schedule settings…</p>
        ) : (
          <ScheduleForm
            key={JSON.stringify(defaults)}
            initial={defaults}
            busy={savingDefaults}
            saveLabel="Save default schedule"
            onSave={saveDefaultSchedule}
          />
        )}
      </section>

      {/* Section 3: Pending Semester Checks / To-Do */}
      <details className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <summary className="cursor-pointer px-4 py-3 text-base font-bold">
          Semester Reminders &amp; Automated Checks
        </summary>
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
          <AdminHome />
        </div>
      </details>
    </div>
  );
}

