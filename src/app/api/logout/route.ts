import { cookies } from 'next/headers';
import { COOKIE, sameOrigin } from '@/lib/auth';
import { failure, privateJson } from '@/lib/http';
export async function POST(request: Request) {
  try { sameOrigin(request); (await cookies()).delete(COOKIE); return privateJson({ ok: true }); } catch (error) { return failure(error); }
}
