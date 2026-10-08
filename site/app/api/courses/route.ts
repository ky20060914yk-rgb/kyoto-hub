import { getCatalog } from '@/lib/server/cached';
import { searchCatalog } from '@/lib/server/public';

// Public: course search for /search and the timetable picker.
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const q = (p.get('q') ?? '').slice(0, 60);
  const period = Number(p.get('period')) || null;
  const day = p.get('day');
  if (!q.trim() && !day) return Response.json({ courses: [] });
  const courses = searchCatalog(await getCatalog(), q, { day, period }, 40);
  return Response.json({ courses }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
