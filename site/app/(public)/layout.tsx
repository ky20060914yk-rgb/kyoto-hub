import { AppShell } from '@/components/shell/AppShell';

// Public pages (search, course summaries): same frame as the app, no sign-in required.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <AppShell requireAuth={false}>{children}</AppShell>;
}
