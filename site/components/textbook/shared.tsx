'use client';

import Link from 'next/link';
import { Chip } from '@/components/course/bits';
import { Icon } from '@/components/ui/Icon';
import { yen } from '@/lib/format';
import { CONDITION, LISTING_TYPE, type Condition, type ListingType } from '@/lib/domain/textbook';

export type Listing = {
  id: string; type: ListingType; title: string; courseId: string | null; courseName: string | null; condition: Condition | null;
  price: number | null; place: string; note: string; photos: string[]; sellerId: string; sellerName: string;
  status: 'open' | 'closed'; createdAt: string; expiresAt: string;
};

export function PriceLabel({ l }: { l: Pick<Listing, 'type' | 'price'> }) {
  if (l.type === 'give') return <span className="text-heading text-success">無料</span>;
  if (l.type === 'want') return <span className="text-heading text-brand">買いたい</span>;
  return <span className="text-heading tabular">{yen(l.price ?? 0)}</span>;
}

export function TypeChip({ type }: { type: ListingType }) {
  return <Chip tone={type === 'give' ? 'success' : type === 'want' ? 'brand' : 'neutral'}>{LISTING_TYPE[type]}</Chip>;
}

export function ListingCard({ l }: { l: Listing }) {
  return (
    <li>
      <Link href={`/textbooks/${l.id}`} className="flex h-full flex-col overflow-hidden rounded-l border border-line bg-surface transition-colors duration-instant hover:border-line-strong">
        <div className="grid aspect-4/3 place-items-center bg-surface-muted text-ink-disabled">
          {l.photos[0] ? (
            // Listing photos are user uploads on Firebase Storage; next/image would need remotePatterns per bucket.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={l.photos[0]} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <Icon name="book" className="size-10" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <span className="flex items-center gap-1.5"><TypeChip type={l.type} />{l.condition ? <span className="text-label text-ink-2">{CONDITION[l.condition]}</span> : null}</span>
          <span className="line-clamp-2 text-body font-medium">{l.title}</span>
          {l.courseName ? <span className="truncate text-caption text-ink-2">{l.courseName}</span> : null}
          <span className="mt-auto flex items-end justify-between gap-2 pt-1">
            <PriceLabel l={l} />
            <span className="truncate text-label text-ink-2">{l.place}</span>
          </span>
        </div>
      </Link>
    </li>
  );
}
