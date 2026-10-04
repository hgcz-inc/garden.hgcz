import { cookies } from 'next/headers';
import { z } from 'zod';
import { COOKIE, demoMode, makeToken, requireAuthConfig, safeEqual, sameOrigin } from '@/lib/auth';
import { body, failure, privateJson } from '@/lib/http';
import { AppError } from '@/lib/validation';
const attempts = new Map<string, { count: number; reset: number }>();
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    if (demoMode()) return privateJson({ ok: true });
    requireAuthConfig();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
    const attempt = attempts.get(ip);
    if (attempt && attempt.reset > Date.now() && attempt.count >= 10) throw new AppError(429, 'Thử lại sau vài phút.');
    const { password } = z.object({ password: z.string().max(300) }).parse(await body(request));
    if (!safeEqual(password, process.env.APP_PASSWORD!)) {
      attempts.set(ip, { count: attempt && attempt.reset > Date.now() ? attempt.count + 1 : 1, reset: Date.now() + 300000 });
      if (attempts.size > 1000) attempts.clear();
      await new Promise(resolve => setTimeout(resolve, 500));
      throw new AppError(401, 'Mật khẩu không đúng.');
    }
    attempts.delete(ip);
    (await cookies()).set(COOKIE, makeToken(process.env.SESSION_SECRET!), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 7 * 86400 });
    return privateJson({ ok: true });
  } catch (error) { return failure(error); }
}
