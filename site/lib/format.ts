/** 「3分前」「2日前」「2026/9/1」 for ISO strings or Firestore Timestamps. */
export function timeAgo(value: unknown, now = Date.now()): string {
  const ms = toMillis(value);
  if (ms === null) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'たった今';
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}日前`;
  const d = new Date(ms);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function toMillis(value: unknown): number | null {
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
  }
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
