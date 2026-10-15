import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { CREDITS } from '@/lib/domain/credits';

export const metadata: Metadata = {
  title: 'はじめての方へ',
  description: '京大InfoHubでできることと、クレジット（ポイント）のしくみ。',
};

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'star', title: '授業レビュー', body: '楽単度、出席の厳しさ、テストやレポートの形式、過去問が役に立つか。履修した京大生の声を授業ごとに読めます。読むのも書くのも無料です。' },
  { icon: 'file', title: '過去問・資料', body: '授業ごとに過去問や資料を共有できます。ダウンロード前に1ページ目の上の方を無料でプレビューできるので、中身を確かめてから使えます。' },
  { icon: 'chat', title: '質問掲示板', body: '「教科書は要る？」「去年の課題は？」など、授業ごとに質問して、履修した人に答えてもらえます。' },
  { icon: 'calendar', title: '時間割', body: '授業ページからワンタップで時間割に登録。今日の授業と、次の授業がすぐわかります。' },
  { icon: 'book', title: '教科書', body: '使い終わった教科書を京大生どうしで譲り合えます。やりとりはサイト内のチャットで、受け渡しはキャンパスで。' },
];

const EARN: [string, string, string?][] = [
  ['京大メールで登録する', `+${CREDITS.welcome}`],
  ['レビューを書く（最初の' + CREDITS.firstReviewCount + '件）', `+${CREDITS.firstReviews}`, '1件ごと'],
  [`レビューが少ない授業に書く（その授業の${CREDITS.scarceThreshold}件目まで）`, `+${CREDITS.scarceReview}`, '上と合わせてもらえます'],
  ['過去問・資料を投稿する', `+${CREDITS.upload}`, '同じ年度・種類の投稿は1回まで'],
  ['ほかの人のリクエストに応えて投稿する', `+${CREDITS.requestFulfilled}`],
  ['友達を招待する（招待コード）', `+${CREDITS.referral}`, `招待した人・された人の両方に。${CREDITS.referralCap}人まで`],
];

const STEPS = [
  { title: '京大メールで登録', body: '@st.kyoto-u.ac.jp のアドレスで登録して、届いたメールのリンクを開きます。転送先ではなく KUMOI を直接見てください。' },
  { title: '授業をさがす', body: '授業名・先生の名前・曜日でさがせます。気になる授業は時間割に登録しておくと便利です。' },
  { title: '履修した授業のレビューを書く', body: '最初の3件はクレジットが多めにもらえます。後輩の履修選びの助けになります。' },
];

const RULES = [
  '書き込めるのは、京大メールで確認できた人だけです。',
  '表示されるのはニックネームだけで、メールアドレスは公開されません。',
  '先生や特定の人への悪口、個人情報（氏名・学籍番号など）の書き込みは禁止です。',
  '試験中の不正につながる書き込み（試験中の答えの共有など）は禁止です。',
  '不適切な投稿は「通報」できます。3人から通報されると自動で非公開になり、運営が確認します。',
];

export default function GuidePage() {
  return (
    <article className="text-body text-ink">
      <p className="text-caption font-medium text-brand">はじめての方へ</p>
      <h1 className="mt-1 text-title">京大InfoHubの使い方</h1>
      <p className="mt-3 text-ink-2">京大生だけが使える、授業の情報共有サイトです。過去問も、授業の評判も、ここに集まります。</p>

      <h2 className="mt-10 text-heading">できること</h2>
      <ul className="mt-4 flex flex-col gap-3">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex gap-4 rounded-l border border-line bg-surface p-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-m bg-brand-subtle text-brand"><Icon name={f.icon} /></span>
            <div>
              <h3 className="text-heading">{f.title}</h3>
              <p className="mt-1 text-caption text-ink-2">{f.body}</p>
            </div>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 text-heading">クレジット（ポイント）のしくみ</h2>
      <p className="mt-3 text-ink-2">
        過去問・資料のダウンロードには<strong className="text-ink">クレジット</strong>を使います。クレジットは、サイトに情報を出してくれた人がもらえるお礼です。
        レビューを読む・書く、掲示板、時間割、教科書は、クレジットなしで使えます。
      </p>

      <div className="mt-5 overflow-hidden rounded-l border border-line bg-surface">
        <p className="flex items-center gap-2 border-b border-line bg-success-bg px-4 py-2 text-label text-success"><Icon name="gift" className="size-4" />もらえる</p>
        <ul>
          {EARN.map(([what, n, note]) => (
            <li key={what} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p>{what}</p>
                {note ? <p className="text-caption text-ink-2">{note}</p> : null}
              </div>
              <span className="shrink-0 text-heading tabular text-success">{n}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 border-y border-line bg-surface-muted px-4 py-2 text-label text-ink-2"><Icon name="coin" className="size-4" />使う</p>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p>過去問・資料を1つダウンロードする</p>
            <p className="text-caption text-ink-2">一度払った資料は、何度でも無料でダウンロードできます。自分の投稿と、自分のリクエストに応えてくれた資料も無料です。</p>
          </div>
          <span className="shrink-0 text-heading tabular">−{CREDITS.downloadCost}</span>
        </div>
      </div>
      <ul className="mt-3 list-disc pl-6 text-caption text-ink-2">
        <li>レビューでもらえるのは1日{CREDITS.reviewDailyCap}回まで、投稿・リクエストでもらえるのは1日{CREDITS.dailyGrantCap}回までです。</li>
        <li>クレジットはお金で買ったり、換金・譲渡したりすることはできません。</li>
        <li>残りのクレジットと履歴はマイページで見られます。</li>
      </ul>

      <h2 className="mt-12 text-heading">はじめかた</h2>
      <ol className="mt-4 flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-brand text-label text-on-brand">{i + 1}</span>
            <div>
              <h3 className="text-heading">{s.title}</h3>
              <p className="mt-1 text-caption text-ink-2">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="mt-12 text-heading">安心して使うために</h2>
      <ul className="mt-3 list-disc pl-6 [&_li]:mt-1">
        {RULES.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <p className="mt-3 text-caption text-ink-2">
        くわしくは<Link href="/legal/terms" className="text-brand underline">利用規約</Link>と
        <Link href="/legal/privacy" className="text-brand underline">プライバシーポリシー</Link>をご覧ください。
      </p>

      <div className="mt-12 flex flex-col gap-2 rounded-l bg-brand-subtle p-5 sm:flex-row sm:items-center">
        <p className="flex-1 text-heading">さっそく授業をさがしてみよう</p>
        <ButtonLink href="/search" variant="secondary">授業をさがす</ButtonLink>
        <ButtonLink href="/signup">京大メールで無料登録</ButtonLink>
      </div>
    </article>
  );
}
