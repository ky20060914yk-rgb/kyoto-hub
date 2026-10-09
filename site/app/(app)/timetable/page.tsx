'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
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
import { COLOR_CLASS, PERIODS, PERIOD_TIME, assignColors, currentPeriod, shortCourseName, slotKey, todaySchedule, type CourseColor } from '@/lib/timetable';
import { HeroBand } from '@/components/shell/HeroBand';
import { useNow } from '@/lib/use-now';

type Slot = { day: Day; period: number };
type CourseInfo = Pick<CatalogCourse, 'id' | 'name' | 'lecturer' | 'courseKey'>;


export default function TimetablePage() {
  const { user } = useAuth();
  const [timetable, setTimetable] = useState<Record<string, string> | null>(null);
  const [courses, setCourses] = useState<Record<string, CourseInfo>>({});
  const [picking, setPicking] = useState<Slot | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const now = useNow();
  const today = todaySchedule({}, now).day;
  const live = currentPeriod(now);

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
      <AppBar title="時間割" tone="brand" />
      <HeroBand>
        {timetable === null ? <Skeleton className="h-24 bg-on-brand/10" /> : (
          now ? <TodayCard timetable={timetable} courses={courses} colors={colors} now={now} /> : null
        )}
      </HeroBand>
      <main className="mx-auto max-w-page px-2 py-4 md:px-8 md:py-6">
        {timetable !== null && count === 0 ? (
          <div className="mx-2 mb-4 flex animate-fade-in items-start gap-3 rounded-l border border-brand bg-brand-subtle p-4">
            <Icon name="calendar" className="mt-0.5 size-5 shrink-0 text-brand" />
            <div>
              <p className="text-heading text-brand">時間割を作りましょう</p>
              <p className="mt-1 text-caption text-ink">点線のマスをタップすると、その曜日・時限の授業だけが出てきます。登録した授業から、レビューや過去問にすぐ行けます。</p>
            </div>
          </div>
        ) : (
          <p className="mb-3 px-2 text-caption text-ink-2">{count}コマ登録中。マスをタップすると、授業の詳細や外す操作ができます。</p>
        )}
        {timetable === null ? (
          <Skeleton className="h-96" />
        ) : (
          <div className="grid grid-cols-timetable gap-1.5 rounded-xl bg-surface p-2 shadow-float md:gap-2 md:p-3" role="grid" aria-label="時間割">
            <div />
            {DAYS.map((d) => (
              <div key={d} role="columnheader" className="flex justify-center py-1">
                <span className={`grid size-7 place-items-center rounded-full text-label ${d === today ? 'bg-brand font-bold text-on-brand' : 'text-ink-2'}`}>
                  {DAY_LABEL[d]}
                </span>
                {d === today ? <span className="sr-only">（今日）</span> : null}
              </div>
            ))}
            {PERIODS.map((p) => (
              <Row key={p} period={p} now={live?.period === p}>
                {DAYS.map((d) => {
                  const key = slotKey(d, p);
                  const id = timetable[key];
                  const c = id ? courses[id] : null;
                  const isToday = d === today;
                  const isNow = live?.day === d && live.period === p;
                  if (!id) {
                    return (
                      <button key={key} onClick={() => setPicking({ day: d, period: p })} aria-label={`${DAY_LABEL[d]}曜${p}限に科目を登録`}
                        className={`group grid min-h-24 place-items-center rounded-l transition-colors duration-fast md:min-h-28 ${
                          isToday ? 'bg-brand-subtle hover:bg-brand-subtle' : 'bg-canvas hover:bg-surface-muted'}`}>
                        <Icon name="plus" className="size-4 text-line-strong transition-colors duration-fast group-hover:text-brand group-active:text-brand" />
                      </button>
                    );
                  }
                  const color = colors.get(c?.courseKey ?? id) ?? 'gray';
                  return (
                    <button key={key} onClick={() => setSelected({ day: d, period: p })}
                      aria-current={isNow ? 'time' : undefined}
                      className={`relative flex min-h-24 flex-col items-start overflow-hidden rounded-l p-2 text-left transition-transform duration-instant active:scale-95 md:min-h-28 md:p-2.5 ${COLOR_CLASS[color]} ${
                        isNow ? 'ring-2 ring-brand ring-offset-2' : ''} ${justAdded === key ? 'animate-fade-in' : ''}`}>
                      {isNow ? <span className="mb-1 rounded-full bg-brand px-1.5 text-label text-on-brand">授業中</span> : null}
                      <span className="line-clamp-3 text-label font-bold">{c ? shortCourseName(c.name) : '…'}</span>
                      <span className="mt-auto w-full truncate text-label opacity-80">{c?.lecturer}</span>
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

function Row({ period, now, children }: { period: number; now?: boolean; children: React.ReactNode }) {
  return (
    <>
      <div className={`flex flex-col items-center justify-center ${now ? 'text-brand' : 'text-ink-2'}`} role="rowheader">
        <span className="text-heading tabular">{period}</span>
        <span className="text-label tabular">{PERIOD_TIME[period]}</span>
      </div>
      {children}
    </>
  );
}

const STATUS_LABEL = { done: '終了', now: '授業中', next: '次の授業', later: '' } as const;

/** 今日の授業: the day's classes in order, the running / next one emphasised. */
function TodayCard({ timetable, courses, colors, now }: {
  now: Date;
  timetable: Record<string, string>;
  courses: Record<string, CourseInfo>;
  colors: Map<string, CourseColor>;
}) {
  const { day, items } = todaySchedule(timetable, now);
  if (!day) return <p className="rounded-l bg-on-brand/10 px-4 py-3 text-body">今日は授業のない日です。ゆっくり休みましょう。</p>;
  if (items.length === 0) return <p className="rounded-l bg-on-brand/10 px-4 py-3 text-body">今日（{DAY_LABEL[day]}曜）に登録した授業はありません。</p>;
  const left = items.filter((i) => i.status !== 'done').length;
  return (
    <div className="animate-fade-in rounded-l bg-surface p-3 text-ink shadow-float">
      <p className="px-1 text-caption text-ink-2">今日の授業 {items.length}コマ{left ? `・あと${left}コマ` : '・今日はおしまい'}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map((it) => {
          const c = courses[it.courseId];
          const emph = it.status === 'now' || it.status === 'next';
          return (
            <li key={it.period}>
              <Link href={`/courses/${it.courseId}`}
                className={`flex items-center gap-3 rounded-m px-2 py-2 transition-colors duration-instant hover:bg-surface-muted ${emph ? 'bg-brand-subtle' : ''} ${it.status === 'done' ? 'opacity-50' : ''}`}>
                <span className="w-12 shrink-0 text-center">
                  <span className="block text-heading tabular">{it.period}限</span>
                  <span className="block text-label tabular text-ink-2">{it.start}</span>
                </span>
                <span className={`h-8 w-1 shrink-0 rounded-full ${COLOR_CLASS[colors.get(c?.courseKey ?? it.courseId) ?? 'gray']}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-body font-medium">{c?.name ?? '…'}</span>
                {STATUS_LABEL[it.status] ? (
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-label ${it.status === 'now' ? 'bg-brand text-on-brand' : it.status === 'next' ? 'border border-brand text-brand' : 'text-ink-2'}`}>
                    {STATUS_LABEL[it.status]}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
