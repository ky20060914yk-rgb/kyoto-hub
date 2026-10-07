import { handle, requireKuUser } from '@/lib/server/auth';

export async function POST(req: Request) {
  return handle(() => requireKuUser(req));
}
