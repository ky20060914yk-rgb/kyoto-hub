import Link from 'next/link';

export function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 text-heading text-ink">
      <span className="grid size-7 place-items-center rounded-m bg-brand text-label text-on-brand">京</span>
      京大InfoHub
    </Link>
  );
}
