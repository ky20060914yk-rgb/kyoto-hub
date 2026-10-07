import type { IconName } from '@/components/ui/Icon';

export const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/search', label: 'さがす', icon: 'search' },
  { href: '/timetable', label: '時間割', icon: 'calendar' },
  { href: '/textbooks', label: '教科書', icon: 'book' },
  { href: '/mypage', label: 'マイページ', icon: 'user' },
];

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
