'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { AppBar } from '@/components/shell/AppShell';
import { Sheet } from '@/components/ui/Sheet';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { SearchBox } from '@/components/search/SearchBox';
import { DAYS, DAY_LABEL, type CatalogCourse, type Day } from '@/lib/public-types';
import { COLOR_CLASS, PERIODS, PERIOD_TIME, assignColors, slotKey } from '@/lib/timetable';

type Slot = { day: Day; period: number };
type CourseInfo = Pick<CatalogCourse, 'id' | 'name' | 'lecturer' | 'courseKey'>;

const todayDay = (): Day | null => DAYS[new Date().getDay() - 1] ?? null;

export default function TimetablePage() {
  const { user } = useAuth();
  const [timetable, setTimetable] = useState<Record<string, string> | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseInfo>>({});
  const [picking, setPicking] = useState<Slot | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const today = todayDay();

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'user_timetables', user.uid), (s) => setTimetable((s.data()?.timetable as Record<string, string>) ?? {}));
  }, [user]);

  // Load names for registered course ids we have not seen yet.
  useEffect(() => {
    if (!timetable) return;
    const missing = [...new Set(Object.values(timetable))].filter((id) => !courses[id]);
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => getDoc(doc(db, 'courses', id)))).then((snaps) => {
      const add: Record<string, CourseInfo> = {};
      for (const s of snaps) {
        const d = s.data();
        add[s.id] = { id: s.id, name: d?.name ?? '（削除された科目）', lecturer: d?.lecturer ?? '', courseKey: d?.courseKey ?? s.id };
      }
      setCourses((c) => ({ ...c, ...add }));
    });
  }, [timetable, courses]);

  const colors = useMemo(
    () => assignColors(timetable ?? {}, (id) => courses[id]?.courseKey ?? id),
    [timetable, courses],
  );

  async function save(next: Record<string, string>) {
    if (!user) return;
    setTimetable(next);
    await setDoc(doc(db, 'user_timetables', user.uid), {
      university_id: 'kyoto_u', user_id: user.uid, timetable: next, updated_at: serverTimestamp(),
    });
  }

  async function register(slot: Slot, c: CatalogCourse) {
    const key = slotKey(slot.day, slot.period);
    setCourses((m) => ({ ...m, [c.id]: { id: c.id, name: c.name, lecturer: c.lecturer, courseKey: c.courseKey } }));
    setPicking(null);
    setJustAdded(key);
    await save({ ...(timetable ?? {}), [key]: c.id });
  }

  async function remove(slot: Slot) {
    const next = { ...(timetable ?? {}) };
    delete next[slotKey(slot.day, slot.period)];
    setSelected(null);
    await save(next);
  }

  const selectedCourse = selected && timetable ? courses[timetable[slotKey(selected.day, selected.period)]] : null;
  const count = timetable ? Object.keys(timetable).length : 0;

  return (
    <>
      <AppBar title="時間割" />
      <main className="mx-auto max-w-page px-2 py-4 md:px-8 md:py-6">
        <p className="mb-3 px-2 text-caption text-ink-2">
          {count ? `${count}コマ登録中。マスをタップすると科目の詳細や外す操作ができます。` : '空いているマスをタップして、履修する科目を登録しましょう。'}
        </p>
        {timetable === null ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="grid grid-cols-timetable gap-1" role="grid" aria-label="時間割">
            <div />
            {DAYS.map((d) => (
              <div key={d} role="columnheader"
                className={`rounded-s py-1.5 text-center text-label ${d === today ? 'bg-brand-subtle text-brand' : 'text-ink-2'}`}>
                {DAY_LABEL[d]}
              </div>
            ))}
            {PERIODS.map((p) => (
              <Row key={p} period={p}>
                {DAYS.map((d) => {
                  const key = slotKey(d, p);
                  const id = timetable[key];
                  const c = id ? courses[id] : null;
                  if (!id) {
                    return (
                      <button key={key} onClick={() => setPicking({ day: d, period: p })} aria-label={`${DAY_LABEL[d]}曜${p}限に科目を登録`}
                        className="grid min-h-24 place-items-center rounded-s border border-dashed border-line-strong bg-surface text-ink-disabled transition-colors duration-instant hover:bg-surface-muted md:min-h-28">
                        <Icon name="plus" className="size-5" />
                      </button>
                    );
                  }
                  const color = colors.get(c?.courseKey ?? id) ?? 'gray';
                  return (
                    <button key={key} onClick={() => setSelected({ day: d, period: p })}
                      className={`flex min-h-24 flex-col items-start overflow-hidden rounded-s p-1.5 text-left transition-opacity duration-instant hover:opacity-90 md:min-h-28 md:p-2 ${COLOR_CLASS[color]} ${justAdded === key ? 'animate-fade-in' : ''}`}>
                      <span className="line-clamp-3 text-label font-bold">{c?.name ?? '…'}</span>
                      <span className="mt-auto line-clamp-1 text-label opacity-80">{c?.lecturer}</span>
                    </button>
                  );
                })}
              </Row>
            ))}
          </div>
        )}
      </main>

      <Sheet open={!!picking} onClose={() => setPicking(null)}
        title={picking ? `${DAY_LABEL[picking.day]}曜${picking.period}限に登録` : ''}>
        {picking ? (
          <SearchBox key={slotKey(picking.day, picking.period)} initialDay={picking.day} initialPeriod={picking.period}
            trailing={(c) => (
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => register(picking, c)}>登録</Button>
            )} />
        ) : null}
      </Sheet>

      <Sheet open={!!selected} onClose={() => setSelected(null)}
        title={selected ? `${DAY_LABEL[selected.day]}曜${selected.period}限` : ''}>
        {selected && selectedCourse ? (
          <div>
            <p className="text-heading">{selectedCourse.name}</p>
            <p className="mt-1 text-caption text-ink-2">{selectedCourse.lecturer}</p>
            <div className="mt-5 flex flex-col gap-2">
              <ButtonLink href={`/courses/${selectedCourse.id}`}>レビュー・過去問を見る</ButtonLink>
              <Button variant="secondary" onClick={() => { setPicking(selected); setSelected(null); }}>別の科目に変える</Button>
              <Button variant="text" className="text-danger" onClick={() => remove(selected)}>時間割から外す</Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

function Row({ period, children }: { period: number; children: React.ReactNode }) {
  return (
    <>
      <div className="flex flex-col items-center justify-center text-ink-2" role="rowheader">
        <span className="text-heading tabular">{period}</span>
        <span className="text-label tabular">{PERIOD_TIME[period]}</span>
      </div>
      {children}
    </>
  );
}
