'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/components/auth/AuthProvider';
import { signOutUser } from '@/lib/firebase/auth-actions';
import { AppBar } from '@/components/shell/AppShell';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { TextField } from '@/components/ui/TextField';
import { StarGlyph } from '@/components/course/bits';
import { timeAgo } from '@/lib/format';
import type { Review } from '@/lib/domain/review';

const REASON: Record<string, string> = {
  signup_bonus: '登録ボーナス',
  referral_in: '招待コードの特典',
  referral_out: '友達の招待',
  first_review: 'レビュー投稿ボーナス',
  scarce_review: 'レビュー募集中の科目へ投稿',
  upload: '資料のアップロード',
  request_fulfilled: 'リクエストに応えた',
  download: '資料のダウンロード',
  download_free: '資料のダウンロード（無料）',
};

type Ledger = { id: string; delta: number; reason: string; createdAt: unknown };

export default function MyPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<{ displayName?: string } | null>(null);
  const [balance, setBalance] = useState<{ balance: number; invitationCode?: string; referralsRewarded?: number } | null>(null);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    const subs = [
      onSnapshot(doc(db, 'users', user.uid), (s) => setProfile(s.data() ?? {})),
      onSnapshot(doc(db, 'credit_balances', user.uid), (s) => setBalance((s.data() as typeof balance) ?? { balance: 0 }), () => setBalance({ balance: 0 })),
      onSnapshot(query(collection(db, 'credits_ledger'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'), limit(20)),
        (s) => setLedger(s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Ledger, 'id'>) }))), () => setLedger([])),
      onSnapshot(query(collection(db, 'reviews'), where('authorId', '==', user.uid)),
        (s) => setReviews(s.docs.map((d) => d.data() as Review).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))), () => setReviews([])),
    ];
    return () => subs.forEach((u) => u());
  }, [user]);

  async function saveName() {
    const v = name.trim();
    if (!user || !v || v.length > 20) return;
    await updateDoc(doc(db, 'users', user.uid), { displayName: v });
    setEditing(false);
  }

  async function copyCode() {
    if (!balance?.invitationCode) return;
    const text = `京大InfoHubに招待コード「${balance.invitationCode}」で登録すると、2人ともクレジットがもらえます。${location.origin}/signup`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <>
      <AppBar title="マイページ" />
      <main className="mx-auto flex max-w-content flex-col gap-4 px-4 py-6">
        <section className="rounded-l border border-line bg-surface p-5">
          {profile === null ? <Skeleton className="h-12" /> : editing ? (
            <div className="flex items-end gap-2">
              <TextField label="表示名（20文字まで）" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} className="flex-1" />
              <Button onClick={saveName} disabled={!name.trim()}>保存</Button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-full bg-brand-subtle text-heading text-brand">
                {(profile.displayName ?? '京')[0]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-heading">{profile.displayName ?? '京大生'}</p>
                <p className="truncate text-caption text-ink-2">{user?.email}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => { setName(profile.displayName ?? ''); setEditing(true); }}>編集</Button>
            </div>
          )}
          <p className="mt-3 text-caption text-ink-2">レビューには表示名だけが出ます。メールアドレスは公開されません。</p>
        </section>

        <section className="rounded-l border border-line bg-surface p-5" aria-labelledby="credit-h">
          <div className="flex items-baseline justify-between">
            <h2 id="credit-h" className="text-heading">クレジット</h2>
            <span className="text-display tabular text-brand">{balance ? balance.balance : '–'}</span>
          </div>
          <p className="mt-1 text-caption text-ink-2">過去問・資料のダウンロードに1つ使います。レビューを書いたり資料をアップロードすると増えます。お金では買えません。</p>
          {ledger.length ? (
            <ul className="mt-3 border-t border-line">
              {ledger.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 border-b border-line py-2 text-caption last:border-b-0">
                  <span className="text-ink">{REASON[l.reason] ?? l.reason}<span className="ml-2 text-ink-disabled">{timeAgo(l.createdAt)}</span></span>
                  <span className={`tabular font-medium ${l.delta > 0 ? 'text-success' : l.delta < 0 ? 'text-ink' : 'text-ink-2'}`}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-l border border-line bg-surface p-5" aria-labelledby="invite-h">
          <h2 id="invite-h" className="text-heading">友達を招待</h2>
          <p className="mt-1 text-caption text-ink-2">招待コードで友達が登録すると、2人とも3クレジットもらえます（10人まで）。</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="flex h-12 flex-1 items-center justify-center rounded-m bg-surface-muted text-title tracking-widest tabular">
              {balance?.invitationCode ?? '……'}
            </span>
            <Button variant="secondary" onClick={copyCode} disabled={!balance?.invitationCode}>{copied ? 'コピーしました' : 'コピー'}</Button>
          </div>
          {balance?.referralsRewarded ? <p className="mt-2 text-caption text-ink-2">これまでに{balance.referralsRewarded}人を招待しました。</p> : null}
        </section>

        <section id="reviews" className="rounded-l border border-line bg-surface p-5" aria-labelledby="my-reviews-h">
          <h2 id="my-reviews-h" className="text-heading">自分のレビュー{reviews ? `（${reviews.length}）` : ''}</h2>
          {reviews === null ? <Skeleton className="mt-3 h-16" /> : reviews.length === 0 ? (
            <p className="mt-2 text-caption text-ink-2">まだレビューを書いていません。履修した科目のレビューを書くと、最初の3件はそれぞれ2クレジットもらえます。</p>
          ) : (
            <ul className="mt-2">
              {reviews.map((r) => (
                <li key={r.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
                  <span className="inline-flex shrink-0">{[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} fill={r.rating >= i ? 1 : 0} className="size-3.5" />)}</span>
                  <span className="min-w-0 flex-1 truncate text-body">{r.courseName}</span>
                  <span className="shrink-0 text-caption text-ink-2">役に立った {r.helpfulBy?.length ?? 0}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <nav className="overflow-hidden rounded-l border border-line bg-surface" aria-label="その他">
          <MenuLink href="/mypage/contact" icon="mail" label="お問い合わせ・不具合の報告" />
          <MenuLink href="/legal/terms" icon="file" label="利用規約" />
          <MenuLink href="/legal/privacy" icon="shield" label="プライバシーポリシー" />
          <button onClick={() => signOutUser().then(() => router.replace('/'))}
            className="flex h-14 w-full items-center gap-3 px-4 text-left text-body text-danger hover:bg-surface-muted">
            <Icon name="logout" />ログアウト
          </button>
        </nav>
      </main>
    </>
  );
}

function MenuLink({ href, icon, label }: { href: string; icon: IconName; label: string }) {
  return (
    <Link href={href} className="flex h-14 items-center gap-3 border-b border-line px-4 text-body text-ink hover:bg-surface-muted">
      <Icon name={icon} className="size-5 text-ink-2" />
      <span className="flex-1">{label}</span>
      <Icon name="chevronRight" className="size-4 text-ink-disabled" />
    </Link>
  );
}
