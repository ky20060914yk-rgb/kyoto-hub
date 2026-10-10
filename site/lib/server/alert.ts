import 'server-only';
import { OPERATOR } from '@/lib/operator';

/**
 * Emails the operator through Resend. Without RESEND_API_KEY (local, tests, or
 * before the secret exists) it only logs. Never throws: an alert failing must
 * not fail the request that triggered it. Resend without a verified domain can
 * only deliver to the account's own address, which is OPERATOR.email.
 */
export async function alertOwner(subject: string, text: string, fetchImpl: typeof fetch = fetch) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn(`[alert skipped: no RESEND_API_KEY] ${subject}`);
    return false;
  }
  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: '京大InfoHub <onboarding@resend.dev>', to: [OPERATOR.email], subject, text }),
    });
    if (!res.ok) console.error(`[alert failed ${res.status}] ${subject}`);
    return res.ok;
  } catch (e) {
    console.error('[alert failed]', e);
    return false;
  }
}
