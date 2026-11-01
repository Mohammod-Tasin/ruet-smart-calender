import type { Category } from '@/core/calendar/rules';

// Category -> look. Adding a category = one more line here (and in CATEGORIES in core).
// `solid` is a bar; tentative bars add the stripes in MonthGrid.
export const CATEGORY_STYLE: Record<Category, { label: string; solid: string; text: string }> = {
  HOLIDAY: {
    label: 'Common Holiday',
    solid: 'bg-red-600 text-white dark:bg-red-700 dark:text-white',
    text: 'text-red-700 dark:text-red-300',
  },
  MID_BREAK: {
    label: 'Mid Break',
    solid: 'bg-orange-600 text-white dark:bg-orange-700 dark:text-white',
    text: 'text-orange-700 dark:text-orange-300',
  },
  UNOFFICIAL_BREAK: {
    label: 'Unofficial Break',
    solid: 'bg-zinc-300 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100',
    text: 'text-zinc-600 dark:text-zinc-300',
  },
  SEMESTER_BREAK: {
    label: 'Semester Break',
    solid: 'bg-orange-600 text-white dark:bg-orange-700 dark:text-white',
    text: 'text-orange-700 dark:text-orange-300',
  },
  EXAM: {
    label: 'Exam',
    solid: 'bg-blue-600 text-white dark:bg-blue-700 dark:text-white',
    text: 'text-blue-700 dark:text-blue-300',
  },
  CLASS: {
    label: 'Class Week',
    solid: 'bg-emerald-600 text-white dark:bg-emerald-700 dark:text-white',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  SUSPENDED_WEEK: {
    label: 'Class Suspension',
    solid: 'bg-slate-500 text-white dark:bg-slate-600 dark:text-white',
    text: 'text-slate-700 dark:text-slate-300',
  },
};

export const categoryStyle = (c: string) =>
  CATEGORY_STYLE[c as Category] ?? CATEGORY_STYLE.HOLIDAY;
