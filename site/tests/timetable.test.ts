import { describe, it, expect } from 'vitest';
import { assignColors, slotKey, todaySchedule, currentPeriod, colorFor, shortCourseName } from '@/lib/timetable';

describe('assignColors', () => {
  it('gives neighbours different colors and a multi-slot course one color', () => {
    const tt = { [slotKey('Mon', 1)]: 'a1', [slotKey('Mon', 2)]: 'b', [slotKey('Thu', 1)]: 'a2' };
    const key = (id: string) => (id.startsWith('a') ? 'A' : 'B');
    const colors = assignColors(tt, key);
    expect(colors.get('A')).toBe('blue');
    expect(colors.get('B')).toBe('green');
    expect(colors.size).toBe(2);
  });

  it('wraps after eight courses', () => {
    const tt: Record<string, string> = {};
    ['Mon', 'Tue'].forEach((d, i) => [1, 2, 3, 4, 5].forEach((p) => (tt[slotKey(d as 'Mon', p)] = `c${i * 5 + p}`)));
    const colors = assignColors(tt, (id) => id);
    expect(colors.get('c9')).toBe('blue');
  });
});

describe('todaySchedule', () => {
  // 2026-10-09 is a Friday.
  const tt = { Fri_1: 'a', Fri_3: 'b', Fri_5: 'c', Mon_1: 'x' };
  const at = (hhmm: string) => new Date(`2026-10-09T${hhmm}:00`);

  it('marks done / now / next / later', () => {
    expect(todaySchedule(tt, at('13:30')).items.map((i) => `${i.period}:${i.status}`)).toEqual(['1:done', '3:now', '5:later']);
    expect(todaySchedule(tt, at('12:10')).items.map((i) => i.status)).toEqual(['done', 'next', 'later']);
    expect(todaySchedule(tt, at('07:00')).items.map((i) => i.status)).toEqual(['next', 'later', 'later']);
    expect(todaySchedule(tt, at('19:00')).items.every((i) => i.status === 'done')).toBe(true);
  });

  it('is empty on weekends', () => {
    expect(todaySchedule(tt, new Date('2026-10-10T10:00:00'))).toEqual({ day: null, items: [] });
  });

  it('currentPeriod follows the period times', () => {
    expect(currentPeriod(at('10:20'))).toBeNull();
    expect(currentPeriod(at('10:30'))).toEqual({ day: 'Fri', period: 2 });
  });

  it('colorFor is stable', () => {
    expect(colorFor('微分積分学')).toBe(colorFor('微分積分学'));
  });
});

describe('shortCourseName', () => {
  it('drops bracketed qualifiers', () => {
    expect(shortCourseName('微分積分学(講義・演義)A1A3')).toBe('微分積分学 A1A3');
    expect(shortCourseName('心理学 (演習) (心理演習)')).toBe('心理学');
    expect(shortCourseName('(講義)')).toBe('(講義)');
    expect(shortCourseName('英語リーディング')).toBe('英語リーディング');
  });
});
