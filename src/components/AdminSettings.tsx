'use client';
import { useEffect, useMemo, useState } from 'react';
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

interface SeriesItem {
  id: number;
  departmentId: number;
  intakeYear: number;
  brothersCount: number;
}

interface SettingsData {
  structure: JourneyStructure;
  femaleStudentPercentage?: number;
  departments?: { id: number; code: string; name: string; studentCount: number }[];
  series?: SeriesItem[];
}

/**
 * Admin Settings tab:
 * 1. Student Statistics & Report Settings (Female percentage, Department series student counts)
 * 2. Brothers Count per Department & Series (Matrix grid)
 * 3. Permanent & Yearly Holidays (Fixed dates every year, Moon-based, and Yearly Manual holidays)
 * 4. Default Semester Schedule Settings (University-wide default weeks for Class, Board Viva, Final)
 * 5. Pending Semester Reminders / Checks
 */
export function AdminSettings() {
  const toast = useToast();
  const [defaults, setDefaults] = useState<ScheduleFields | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [femalePercentage, setFemalePercentage] = useState<number>(15);
  const [deptCounts, setDeptCounts] = useState<Record<string, number>>({});
  const [departmentsList, setDepartmentsList] = useState<{ id: number; code: string; name: string }[]>([]);
  const [seriesList, setSeriesList] = useState<SeriesItem[]>([]);
  const [brothersCounts, setBrothersCounts] = useState<Record<number, number>>({});
  const [savingStudentStats, setSavingStudentStats] = useState(false);
  const [savingBrothers, setSavingBrothers] = useState(false);

  useEffect(() => {
    api<SettingsData>('/api/admin/academic-settings').then((r) => {
      if (r.ok) {
        const f = fieldsFromStructure(r.data.structure);
        setDefaults(f ?? fieldsFromStructure(DEFAULT_STRUCTURE)!);
        if (r.data.femaleStudentPercentage !== undefined) {
          setFemalePercentage(r.data.femaleStudentPercentage);
        }
        if (r.data.departments) {
          setDepartmentsList(r.data.departments);
          const counts: Record<string, number> = {};
          r.data.departments.forEach((d) => {
            counts[d.code] = d.studentCount;
          });
          setDeptCounts(counts);
        }
        if (r.data.series) {
          setSeriesList(r.data.series);
          const bMap: Record<number, number> = {};
          r.data.series.forEach((s) => {
            bMap[s.id] = s.brothersCount ?? 0;
          });
          setBrothersCounts(bMap);
        }
      } else {
        setDefaults(fieldsFromStructure(DEFAULT_STRUCTURE)!);
      }
    });
  }, []);

  const intakeYears = useMemo(() => {
    const years = Array.from(new Set(seriesList.map((s) => s.intakeYear)));
    return years.sort((a, b) => a - b);
  }, [seriesList]);

  // Lookup map: `${departmentId}-${intakeYear}` -> SeriesItem
  const seriesByDeptAndYear = useMemo(() => {
    const map = new Map<string, SeriesItem>();
    seriesList.forEach((s) => {
      map.set(`${s.departmentId}-${s.intakeYear}`, s);
    });
    return map;
  }, [seriesList]);

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

  async function saveStudentStats() {
    setSavingStudentStats(true);
    const r = await api('/api/admin/academic-settings', {
      method: 'PUT',
      body: {
        femaleStudentPercentage: femalePercentage,
        departmentCounts: deptCounts,
      },
    });
    setSavingStudentStats(false);
    if (!r.ok) return toast(r.message, 'error');
    toast('Student settings saved.');
  }

  async function saveBrothersCounts() {
    setSavingBrothers(true);
    const r = await api('/api/admin/academic-settings', {
      method: 'PUT',
      body: {
        brothersCounts,
      },
    });
    setSavingBrothers(false);
    if (!r.ok) return toast(r.message, 'error');
    toast('Brothers count saved successfully.');
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Student Statistics & Report Settings */}
      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-bold">Student Statistics &amp; Report Settings</h2>
        </div>

        <div className="space-y-4">
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Female Students Percentage (%)
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                value={femalePercentage}
                onChange={(e) =>
                  setFemalePercentage(Math.max(0, Math.min(100, Number(e.target.value) || 0)))
                }
                className="w-24 rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-500">%</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">
              Default is 15%. Used to calculate female students in the PDF summary table.
            </p>
          </div>

          {departmentsList.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                Student Count per Series by Department
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
                {departmentsList.map((d) => (
                  <div
                    key={d.code}
                    className="rounded border border-zinc-200 p-2 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900"
                  >
                    <div className="text-xs font-bold text-zinc-700 dark:text-zinc-300">
                      {d.code}
                    </div>
                    <input
                      type="number"
                      min={0}
                      value={deptCounts[d.code] ?? 60}
                      onChange={(e) =>
                        setDeptCounts((prev) => ({
                          ...prev,
                          [d.code]: Number(e.target.value) || 0,
                        }))
                      }
                      className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={savingStudentStats}
            onClick={saveStudentStats}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {savingStudentStats ? 'Saving…' : 'Save student settings'}
          </button>
        </div>
      </section>

      {/* Section 2: Brothers Count per Dept per Series */}
      <section className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Brothers Count</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Configure the number of brothers for each department and series batch. Displayed in
              the PDF report beside the student count.
            </p>
          </div>
          <button
            type="button"
            disabled={savingBrothers}
            onClick={saveBrothersCounts}
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {savingBrothers ? 'Saving…' : 'Save brothers count'}
          </button>
        </div>

        {departmentsList.length > 0 && intakeYears.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[500px] border-collapse text-left text-sm">
              <thead className="bg-zinc-100 dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 font-semibold">
                <tr>
                  <th className="p-2.5 border-b border-zinc-200 dark:border-zinc-800">
                    Department
                  </th>
                  {intakeYears.map((yr) => (
                    <th
                      key={yr}
                      className="p-2.5 text-center border-b border-zinc-200 dark:border-zinc-800"
                    >
                      Series &apos;{String(yr).slice(-2)} ({yr})
                    </th>
                  ))}
                  <th className="p-2.5 text-center border-b border-zinc-200 dark:border-zinc-800">
                    Dept Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {departmentsList.map((d) => {
                  let rowTotal = 0;
                  return (
                    <tr
                      key={d.id}
                      className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <td className="p-2.5 font-medium text-zinc-900 dark:text-zinc-100">
                        {d.code}
                      </td>
                      {intakeYears.map((yr) => {
                        const s = seriesByDeptAndYear.get(`${d.id}-${yr}`);
                        if (!s) {
                          return (
                            <td key={yr} className="p-2.5 text-center text-zinc-400">
                              —
                            </td>
                          );
                        }
                        const val = brothersCounts[s.id] ?? 0;
                        rowTotal += val;
                        return (
                          <td key={yr} className="p-2 text-center">
                            <input
                              type="number"
                              min={0}
                              value={val}
                              onChange={(e) => {
                                const n = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setBrothersCounts((prev) => ({
                                  ...prev,
                                  [s.id]: n,
                                }));
                              }}
                              className="w-18 sm:w-20 rounded border border-zinc-300 px-2 py-1 text-center text-sm dark:border-zinc-700 dark:bg-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                            />
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-center font-bold text-zinc-700 dark:text-zinc-300">
                        {rowTotal}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-zinc-50 dark:bg-zinc-900/80 font-semibold border-t-2 border-zinc-300 dark:border-zinc-700">
                <tr>
                  <td className="p-2.5">Total</td>
                  {intakeYears.map((yr) => {
                    const colTotal = departmentsList.reduce((sum, d) => {
                      const s = seriesByDeptAndYear.get(`${d.id}-${yr}`);
                      return sum + (s ? brothersCounts[s.id] ?? 0 : 0);
                    }, 0);
                    return (
                      <td key={yr} className="p-2.5 text-center">
                        {colTotal}
                      </td>
                    );
                  })}
                  <td className="p-2.5 text-center font-bold text-zinc-900 dark:text-zinc-100">
                    {Object.values(brothersCounts).reduce((a, b) => a + b, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Loading series structure…</p>
        )}
      </section>

      {/* Section 3: Permanent & Yearly Holidays */}
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <YearlyHolidays />
      </section>

      {/* Section 4: Default Semester Schedule Settings */}
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

      {/* Section 5: Pending Semester Checks / To-Do */}
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

