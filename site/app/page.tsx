import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Logo } from '@/components/brand/Logo';
import { ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Chip, DistributionBars, Stars, StarGlyph } from '@/components/course/bits';
import { CountUp, Reveal } from '@/components/lp/Reveal';
import { getSiteStats } from '@/lib/server/cached';

export const metadata: Metadata = {
  title: { absolute: '京大InfoHub — 京大生のための授業レビュー・過去問・教科書' },
  description: '楽単かどうか、出席は厳しいか、過去問は効くか。京大生だけのレビューで履修と試験を決めよう。過去問の共有、教科書の譲り合いも。京大メールで無料登録。',
  alternates: { canonical: '/' },
};

export default function Landing() {
  return (
    <div className="bg-surface">
      <Header />
      <main>
        <Hero />
        <Suspense fallback={<StatsBand courses={10000} reviews={null} />}>
          <Stats />
        </Suspense>
        <Features />
        <Trust />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface">
      <div className="mx-auto flex h-16 max-w-page items-center gap-3 px-4 md:px-6">
        <Logo />
        <nav className="ml-auto flex items-center gap-1">
          <Link href="/search" className="hidden h-10 items-center rounded-m px-3 text-body text-ink hover:bg-surface-muted sm:inline-flex">授業をさがす</Link>
          <Link href="/login" className="inline-flex h-10 items-center rounded-m px-3 text-body text-ink hover:bg-surface-muted">ログイン</Link>
          <ButtonLink href="/signup" size="sm" className="h-10 rounded-m px-4 text-body">無料登録</ButtonLink>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="overflow-hidden">
      <div className="mx-auto grid max-w-page items-center gap-12 px-4 py-16 md:grid-cols-2 md:px-6 md:py-24">
        <div>
          <p className="text-caption font-medium text-brand">京大生専用・無料</p>
          <h1 className="mt-3 text-hero md:text-hero-lg">
            その授業、<br />
            <span className="mx-1 inline-block rounded-full bg-brand-subtle px-4 text-brand">楽単</span>？
          </h1>
          <p className="mt-5 max-w-content text-lead text-ink-2 md:text-lead-lg">
            出席の厳しさ、成績のつけ方、過去問の効き。<br className="hidden md:inline" />
            履修した先輩のレビューで、授業選びと試験対策を。
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink href="/signup" className="h-14 px-8 text-heading">京大メールで無料登録</ButtonLink>
            <ButtonLink href="/search" variant="secondary" className="h-14 px-6">登録せずに授業を見る</ButtonLink>
          </div>
          <p className="mt-3 text-caption text-ink-2">@st.kyoto-u.ac.jp のアドレスで登録できます。</p>
        </div>
        <Reveal><HeroMock /></Reveal>
      </div>
    </section>
  );
}

/** The real course-page components with sample data — the product is the picture. */
function HeroMock() {
  return (
    <div className="relative mx-auto w-full max-w-md" aria-hidden>
      <div className="rounded-xl border border-line bg-surface p-5 shadow-mock">
        <p className="text-heading">微分積分学（講義・演習）A</p>
        <p className="mt-0.5 text-caption text-ink-2">月2・木1・全学共通科目</p>
        <div className="mt-4 flex items-end gap-4">
          <span className="text-display tabular">4.3</span>
          <span className="pb-1"><Stars value={4.3} count={38} /></span>
          <span className="ml-auto pb-1"><Chip tone="success">楽単</Chip></span>
        </div>
        <div className="mt-5 grid gap-4">
          <DistributionBars title="出席" counts={{ none: 21, light: 13, heavy: 4 }} labels={{ none: '取らない', light: '取る（ゆるい）', heavy: '毎回（重い）' }} />
          <DistributionBars title="過去問の効き" counts={{ as_is: 17, similar: 15, trend_only: 4, not_useful: 2 }} labels={{ as_is: 'ほぼそのまま', similar: '類題が出る', trend_only: '傾向把握に有用', not_useful: '効かない・不明' }} />
        </div>
      </div>
      <div className="absolute -bottom-8 -left-4 hidden w-64 rounded-l border border-line bg-surface p-4 shadow-mock sm:block md:-left-10">
        <span className="inline-flex">{[1, 2, 3, 4, 5].map((i) => <StarGlyph key={i} fill={1} className="size-3.5" />)}</span>
        <p className="mt-1.5 text-caption text-ink">演習問題がほぼそのまま期末に出ました。毎週の小テストは出ておけば大丈夫。</p>
        <p className="mt-1.5 text-label text-ink-2">2025前期・評価A</p>
      </div>
    </div>
  );
}

async function Stats() {
  await connection(); // request time, never build time (no database at build)
  const s = await getSiteStats();
  return <StatsBand courses={s.courses} reviews={s.reviews} />;
}

function StatsBand({ courses, reviews }: { courses: number; reviews: number | null }) {
  const items: { value: React.ReactNode; label: string }[] = [
    { value: <><CountUp value={courses} /><span className="text-h3"> 科目</span></>, label: '全学共通科目をほぼすべて掲載' },
    reviews && reviews >= 100
      ? { value: <><CountUp value={reviews} /><span className="text-h3"> 件</span></>, label: '京大生が書いた授業レビュー' }
      : { value: <>5<span className="text-h3"> 項目</span></>, label: '楽単度・出席・成績・過去問・持ち込み' },
    { value: <>100<span className="text-h3">%</span></>, label: '京大生だけ（京大メールで認証）' },
  ];
  return (
    <section className="border-y border-line bg-canvas">
      <dl className="mx-auto grid max-w-page gap-8 px-4 py-12 text-center sm:grid-cols-3 md:px-6">
        {items.map((it, i) => (
          <Reveal key={it.label} delay={i as 0 | 1 | 2}>
            <dt className="sr-only">{it.label}</dt>
            <dd className="text-stat text-brand md:text-stat-lg">{it.value}</dd>
            <dd className="mt-2 text-caption text-ink-2">{it.label}</dd>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

const FEATURES: { icon: IconName; kicker: string; title: string; body: string; points: string[] }[] = [
  {
    icon: 'star', kicker: '授業レビュー', title: '履修の前に、楽単かどうかがわかる',
    body: '「楽単度」「出席」「成績のつけ方」「過去問の効き」「持ち込み」の5項目と自由コメント。履修した京大生のレビューが科目ごとに集まります。',
    points: ['楽単ランキング・レビューが多い科目', '科目名・教員名・曜限で検索', 'レビューを読むのも書くのも無料'],
  },
  {
    icon: 'calendar', kicker: '時間割', title: '時間割に登録して、毎週の授業をひと目で',
    body: '空いているコマをタップすると、その曜限の授業だけが出てきます。登録した授業からレビューや過去問にすぐ飛べます。',
    points: ['曜限で絞り込んだ検索から登録', '授業ごとに色分け', 'スマホでもPCでも'],
  },
  {
    icon: 'file', kicker: '過去問・資料', title: '試験前に、過去問と先輩のまとめを',
    body: '過去問や解答・まとめを共有できます。アップロードやレビューでクレジットがたまり、1クレジットで1つの資料をダウンロード。欲しい年度はリクエストも。',
    points: ['登録で3クレジットもらえる', 'お金では買えない、助け合いの仕組み', '権利者からの削除依頼には即対応'],
  },
  {
    icon: 'book', kicker: '教科書', title: '使わなくなった教科書を、次の京大生へ',
    body: '「譲ります」「売ります」「買いたい」を学内で。受け渡しは時計台前や生協前などキャンパスで、お金のやり取りは手渡しで。',
    points: ['探している科目の教科書が出たら通知', '取引後はお互いに評価', '手数料なし'],
  },
];

function Features() {
  return (
    <section aria-labelledby="features-h" className="mx-auto max-w-page px-4 py-16 md:px-6 md:py-24">
      <Reveal>
        <h2 id="features-h" className="text-center text-h2 md:text-h2-lg">履修から試験、教科書まで。<br className="sm:hidden" />京大生の「知りたい」を1つに。</h2>
      </Reveal>
      <div className="mt-12 grid gap-6 md:grid-cols-2">
        {FEATURES.map((f, i) => (
          <Reveal key={f.kicker} delay={(i % 2) as 0 | 1}>
            <article className="h-full rounded-xl bg-canvas p-6 md:p-8">
              <span className="grid size-12 place-items-center rounded-l bg-surface text-brand"><Icon name={f.icon} className="size-6" /></span>
              <p className="mt-5 text-caption font-medium text-brand">{f.kicker}</p>
              <h3 className="mt-1 text-h3 md:text-h3-lg">{f.title}</h3>
              <p className="mt-3 text-body text-ink-2">{f.body}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {f.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 text-body"><Icon name="check" className="mt-1 size-4 shrink-0 text-success" />{p}</li>
                ))}
              </ul>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Trust() {
  const items: { icon: IconName; title: string; body: string }[] = [
    { icon: 'shield', title: '京大生だけの場所', body: '京大メール（@st.kyoto-u.ac.jp）で確認できた人だけが書き込めます。' },
    { icon: 'user', title: 'レビューは匿名', body: '表示されるのはニックネームだけ。メールアドレスは公開されません。' },
    { icon: 'flag', title: '通報と削除に対応', body: '不適切な投稿は通報で非公開に。教員・権利者からの削除依頼にはすぐに対応します。' },
  ];
  return (
    <section aria-labelledby="trust-h" className="border-t border-line bg-canvas">
      <div className="mx-auto max-w-page px-4 py-16 md:px-6">
        <h2 id="trust-h" className="text-center text-h3 md:text-h3-lg">安心して使えるように</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          {items.map((it, i) => (
            <Reveal key={it.title} delay={i as 0 | 1 | 2}>
              <Icon name={it.icon} className="size-6 text-brand" />
              <h3 className="mt-3 text-heading">{it.title}</h3>
              <p className="mt-1 text-caption text-ink-2">{it.body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-page px-4 py-16 md:px-6 md:py-24">
      <Reveal>
        <div className="rounded-xl bg-brand px-6 py-14 text-center text-on-brand md:py-20">
          <h2 className="text-h2 md:text-h2-lg">次の履修登録は、先輩の声を聞いてから。</h2>
          <p className="mt-3 text-lead opacity-90">登録は1分。京大メールだけで、ずっと無料です。</p>
          <Link href="/signup" className="mt-8 inline-flex h-14 items-center rounded-m bg-surface px-8 text-heading text-brand transition-colors duration-instant hover:bg-brand-subtle">
            京大メールで無料登録
          </Link>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-page flex-col gap-4 px-4 py-8 text-caption text-ink-2 sm:flex-row sm:items-center md:px-6">
        <span>© 京大InfoHub　京都大学の公式サービスではありません。</span>
        <nav className="flex flex-wrap gap-4 sm:ml-auto">
          <Link href="/search" className="hover:text-ink">授業をさがす</Link>
          <Link href="/legal/terms" className="hover:text-ink">利用規約</Link>
          <Link href="/legal/privacy" className="hover:text-ink">プライバシーポリシー</Link>
          <Link href="/legal/takedown" className="hover:text-ink">削除依頼（教員・権利者の方）</Link>
        </nav>
      </div>
    </footer>
  );
}
