import 'server-only';
import type { Transaction, WriteBatch } from 'firebase-admin/firestore';
import { adminDb } from './admin';

export type NotificationKind = 'review_helpful' | 'request_fulfilled' | 'textbook_match' | 'textbook_message' | 'textbook_rated' | 'listing_expiring' | 'resource_removed';

export type NewNotification = { uid: string; kind: NotificationKind; title: string; body?: string; href?: string };

/** Queue a notification in the caller's transaction / batch, or write it directly. */
export function notify(n: NewNotification, w?: Transaction | WriteBatch) {
  const ref = adminDb.collection('notifications').doc();
  const data = { ...n, body: n.body ?? '', href: n.href ?? null, read: false, createdAt: new Date().toISOString(), university_id: 'kyoto_u' };
  if (w) (w as WriteBatch).set(ref, data);
  else return ref.set(data);
}
