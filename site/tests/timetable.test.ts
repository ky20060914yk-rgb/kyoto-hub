import { describe, it, expect } from 'vitest';
import { assignColors, slotKey } from '@/lib/timetable';

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
