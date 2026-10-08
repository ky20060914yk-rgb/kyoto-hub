import { handle, requireKuUser } from '@/lib/server/auth';
import { claimWelcome } from '@/lib/server/welcome';

// Called once by the client after the first verified sign-in. Idempotent.
export async function POST(req: Request) {
  return handle(async () => claimWelcome((await requireKuUser(req)).uid));
}
