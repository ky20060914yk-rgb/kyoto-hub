import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-content items-center px-4"><Logo /></div>
      </header>
      <main className="mx-auto max-w-content px-4 py-10">{children}</main>
      <footer className="mx-auto max-w-content px-4 pb-10 text-caption text-ink-2">
        <Link href="/" className="hover:text-ink">トップへ戻る</Link>
      </footer>
    </div>
  );
}
