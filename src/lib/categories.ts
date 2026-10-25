import type { Category } from '@/core/calendar/rules';

// Category -> look. Adding a category = one more line here (and in CATEGORIES in core).
// `solid` is a bar, `dot` is a thin mobile bar; tentative bars add the stripes in MonthGrid.
export const CATEGORY_STYLE: Record<Category, { label: string; solid: string; text: string }> = {
  HOLIDAY: {
    label: 'Holiday',
    solid: 'bg-red-600 dark:bg-red-700',
    text: 'text-red-700 dark:text-red-300',
  },
};

export const categoryStyle = (c: string) => CATEGORY_STYLE[c as Category] ?? CATEGORY_STYLE.HOLIDAY;
