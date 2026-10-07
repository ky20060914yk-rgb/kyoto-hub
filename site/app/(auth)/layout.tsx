import { Logo } from '@/components/brand/Logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <Logo />
      <main className="mt-8 w-full max-w-sm rounded-l border border-line bg-surface p-6 md:p-8">{children}</main>
    </div>
  );
}
