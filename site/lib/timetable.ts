import { DAYS, type Day } from '@/lib/public-types';

export const PERIODS = [1, 2, 3, 4, 5] as const;
/** Kyoto University period times. */
export const PERIOD_TIME: Record<number, string> = {
  1: '8:45', 2: '10:30', 3: '13:15', 4: '15:00', 5: '16:45',
};

export const COURSE_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'teal', 'gray'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

/** Static class names so Tailwind generates them (design.md §2.1 course colors). */
export const COLOR_CLASS: Record<CourseColor, string> = {
  blue: 'bg-course-blue text-course-blue-fg',
  green: 'bg-course-green text-course-green-fg',
  yellow: 'bg-course-yellow text-course-yellow-fg',
  orange: 'bg-course-orange text-course-orange-fg',
  red: 'bg-course-red text-course-red-fg',
  purple: 'bg-course-purple text-course-purple-fg',
  teal: 'bg-course-teal text-course-teal-fg',
  gray: 'bg-course-gray text-course-gray-fg',
};

/** Same key format as the Flutter app: `Mon_1`. */
export const slotKey = (day: Day, period: number) => `${day}_${period}`;

/**
 * One color per distinct course, handed out in grid order (Mon1, Mon2, … Fri5)
 * so neighbouring cells get different colors. A course in several slots keeps
 * one color.
 */
export function assignColors(timetable: Record<string, string>, courseKeyOf: (courseId: string) => string): Map<string, CourseColor> {
  const byKey = new Map<string, CourseColor>();
  for (const day of DAYS) {
    for (const p of PERIODS) {
      const id = timetable[slotKey(day, p)];
      if (!id) continue;
      const k = courseKeyOf(id) || id;
      if (!byKey.has(k)) byKey.set(k, COURSE_COLORS[byKey.size % COURSE_COLORS.length]);
    }
  }
  return byKey;
}
