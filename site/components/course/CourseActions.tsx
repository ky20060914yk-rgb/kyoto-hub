'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { slotKey } from '@/lib/timetable';
import { DAY_LABEL, type Day } from '@/lib/public-types';

/** Fired by 「レビューを書く」 outside the review list; ReviewSection opens its form. */
export const OPEN_REVIEW_FORM = 'open-review-form';

/** Side-card actions: register this slot in the timetable, write a review. */
export function CourseActions({ courseId, courseName, dayOfWeek, period }: { courseId: string; courseName: string; dayOfWeek: Day; period: number }) {
  const { user, verified, loading } = useAuth();
  const [timetable, setTimetable] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const key = slotKey(dayOfWeek, period);
  const label = `${DAY_LABEL[dayOfWeek]}曜${period}限`;

  useEffect(() => {
    if (!user || !verified) return;
    return onSnapshot(doc(db, 'user_timetables', user.uid), (s) => setTimetable((s.data()?.timetable as Record<string, string>) ?? {}), () => setTimetable({}));
  }, [user, verified]);

  if (loading) return null;
  if (!user || !verified) {
    return (
      <div className="flex flex-col gap-2">
        <ButtonLink href={`/signup`}>京大メールで無料登録</ButtonLink>
        <p className="text-center text-label text-ink-2">登録すると時間割への追加・レビューの閲覧ができます</p>
      </div>
    );
  }

  const registered = timetable?.[key] === courseId;
  const occupied = !!timetable?.[key] && !registered;

  async function register() {
    if (!user || !timetable) return;
    if (occupied && !confirm(`${label}にはすでに別の授業が入っています。「${courseName}」に入れ替えますか？`)) return;
    setBusy(true);
    await setDoc(doc(db, 'user_timetables', user.uid), {
      university_id: 'kyoto_u', user_id: user.uid, timetable: { ...timetable, [key]: courseId }, updated_at: serverTimestamp(),
    }).catch(() => {});
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      {registered ? (
        <ButtonLink href="/timetable" variant="secondary">
          <Icon name="check" className="size-5 text-success" />時間割に登録済み（{label}）
        </ButtonLink>
      ) : (
        <Button onClick={register} loading={busy} disabled={timetable === null}>
          <Icon name="calendar" className="size-5" />時間割に登録（{label}）
        </Button>
      )}
      <Button variant="secondary" onClick={() => window.dispatchEvent(new Event(OPEN_REVIEW_FORM))}>
        <Icon name="star" className="size-5 text-star" />レビューを書く
      </Button>
    </div>
  );
}
