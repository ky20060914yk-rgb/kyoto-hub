import Link from 'next/link';

// Replaced by the LP in M6.
export default function Home() {
  return (
    <main className="mx-auto max-w-content px-4 py-24">
      <h1 className="text-hero md:text-hero-lg">京大InfoHub</h1>
      <p className="mt-4 text-lead text-ink-2">京大生のための授業レビュー・過去問・教科書。</p>
      <Link href="/signup" className="mt-8 inline-flex h-12 items-center rounded-m bg-brand px-6 font-medium text-on-brand">
        京大メールで無料登録
      </Link>
    </main>
  );
}
