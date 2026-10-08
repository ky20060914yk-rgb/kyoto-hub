'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Logo } from '@/components/brand/Logo';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { NAV, isActive } from './nav';
import { useUnreadCount } from './useUnreadCount';

/**
 * App frame: sidebar on desktop, bottom tabs on mobile. With `requireAuth`,
 * signed-out / unverified users are redirected. Everything that reads the URL
 * sits inside <Suspense> so pages keep a prerendered static shell.
 */
export function AppShell({ children, requireAuth = true }: { children: React.ReactNode; requireAuth?: boolean }) {
  return (
    <div className="min-h-dvh md:flex">
      <Suspense fallback={<aside className="hidden w-sidebar shrink-0 border-r border-line bg-surface md:block" />}>
        <Sidebar />
      </Suspense>
      <div className="min-w-0 flex-1 pb-tabbar md:pb-0">
        {requireAuth ? (
          <Suspense fallback={<ShellSkeleton />}>
            <AuthGate>{children}</AuthGate>
          </Suspense>
        ) : (
          children
        )}
      </div>
      <Suspense fallback={null}>
        <BottomTabs />
      </Suspense>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, verified } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!verified) router.replace('/verify');
  }, [loading, user, verified, router, pathname]);
  return !loading && verified ? children : <ShellSkeleton />;
}

function Sidebar() {
  const pathname = usePathname();
  const unread = useUnreadCount();
  return (
    <aside className="sticky top-0 hidden h-dvh w-sidebar shrink-0 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
      <div className="px-3"><Logo href="/search" /></div>
      <nav className="mt-6 flex flex-col gap-1" aria-label="メイン">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
              className={`flex h-10 items-center gap-3 rounded-m px-3 text-body transition-colors duration-instant ${
                active ? 'bg-brand-subtle font-medium text-brand' : 'text-ink hover:bg-surface-muted'}`}>
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
        <Link href="/notifications" aria-current={isActive(pathname, '/notifications') ? 'page' : undefined}
          className={`flex h-10 items-center gap-3 rounded-m px-3 text-body transition-colors duration-instant ${
            isActive(pathname, '/notifications') ? 'bg-brand-subtle font-medium text-brand' : 'text-ink hover:bg-surface-muted'}`}>
          <Icon name="bell" />
          通知
          {unread > 0 ? <span className="ml-auto rounded-full bg-danger px-2 text-label text-on-brand tabular">{unread}</span> : null}
        </Link>
      </nav>
    </aside>
  );
}

function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="メイン"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-safe md:hidden">
      <ul className="grid h-tabbar grid-cols-4">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-1 text-label ${active ? 'text-brand' : 'text-ink-2'}`}>
                <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors duration-fast ease-out-cubic ${
                  active ? 'bg-brand-subtle' : 'bg-transparent'}`}>
                  <Icon name={item.icon} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ShellSkeleton() {
  return (
    <div className="p-4 md:p-8" aria-busy>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="mt-6 h-20" />
      <Skeleton className="mt-3 h-20" />
      <Skeleton className="mt-3 h-20" />
    </div>
  );
}

/** Top bar: page title + bell (mobile). Sticky. */
export function AppBar({ title, back, actions }: { title: string; back?: string; actions?: React.ReactNode }) {
  const unread = useUnreadCount();
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-surface px-4 md:px-8">
      {back ? (
        <Link href={back} className="-ml-2 grid size-tap place-items-center rounded-full text-ink hover:bg-surface-muted" aria-label="戻る">
          <Icon name="chevronLeft" />
        </Link>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-title">{title}</h1>
      {actions}
      <Link href="/notifications" className="relative grid size-tap place-items-center rounded-full text-ink hover:bg-surface-muted md:hidden"
        aria-label={unread > 0 ? `通知 ${unread}件の未読` : '通知'}>
        <Icon name="bell" />
        {unread > 0 ? <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-danger" /> : null}
      </Link>
    </header>
  );
}
