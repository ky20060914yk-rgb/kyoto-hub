import { DAYS, type Day } from '@/lib/public-types';

export const PERIODS = [1, 2, 3, 4, 5] as const;
/** Kyoto University period times. */
export const PERIOD_TIME: Record<number, string> = {
  1: '8:45', 2: '10:30', 3: '13:15', 4: '15:00', 5: '16:45',
};
export const PERIOD_END: Record<number, string> = {
  1: '10:15', 2: '12:00', 3: '14:45', 4: '16:30', 5: '18:15',
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

/** Left accent bar for timetable cells (static names for Tailwind). */
export const ACCENT_CLASS: Record<CourseColor, string> = {
  blue: 'border-course-blue-fg', green: 'border-course-green-fg', yellow: 'border-course-yellow-fg', orange: 'border-course-orange-fg',
  red: 'border-course-red-fg', purple: 'border-course-purple-fg', teal: 'border-course-teal-fg', gray: 'border-course-gray-fg',
};

/** Stable color for a course outside the timetable (course icons in lists). */
export function colorFor(key: string): CourseColor {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return COURSE_COLORS[h % COURSE_COLORS.length];
}

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

const DAY_INDEX: Record<number, Day | undefined> = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export type TodayItem = { period: number; courseId: string; start: string; end: string; status: 'done' | 'now' | 'next' | 'later' };

/**
 * Today's registered classes in period order, each tagged done / now / next / later
 * for `now` (local time). `day` is null on weekends.
 */
export function todaySchedule(timetable: Record<string, string>, now: Date | null = new Date()): { day: Day | null; items: TodayItem[] } {
  if (!now) return { day: null, items: [] };
  const day = DAY_INDEX[now.getDay()] ?? null;
  if (!day) return { day, items: [] };
  const t = now.getHours() * 60 + now.getMinutes();
  let nextGiven = false;
  const items = PERIODS.flatMap((p) => {
    const courseId = timetable[slotKey(day, p)];
    if (!courseId) return [];
    const start = minutes(PERIOD_TIME[p]);
    const end = minutes(PERIOD_END[p]);
    let status: TodayItem['status'] = 'later';
    if (t >= end) status = 'done';
    else if (t >= start) status = 'now';
    else if (!nextGiven) status = 'next';
    if (status === 'now' || status === 'next') nextGiven = true;
    return [{ period: p, courseId, start: PERIOD_TIME[p], end: PERIOD_END[p], status }];
  });
  return { day, items };
}

/** The period running at `now` today (for highlighting the grid), or null. */
export function currentPeriod(now: Date | null = new Date()): { day: Day; period: number } | null {
  if (!now) return null;
  const day = DAY_INDEX[now.getDay()];
  if (!day) return null;
  const t = now.getHours() * 60 + now.getMinutes();
  const p = PERIODS.find((x) => t >= minutes(PERIOD_TIME[x]) && t < minutes(PERIOD_END[x]));
  return p ? { day, period: p } : null;
}
