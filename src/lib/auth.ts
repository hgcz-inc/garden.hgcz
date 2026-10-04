import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { AppError } from './validation';
export const COOKIE = 'gardencare_session';
export function safeEqual(a: string, b: string) {
  const left = createHmac('sha256', 'gardencare-compare').update(a).digest();
  const right = createHmac('sha256', 'gardencare-compare').update(b).digest();
  return timingSafeEqual(left, right);
}
export function makeToken(secret: string, expires = Date.now() + 7 * 86400000) {
  return `${expires}.${createHmac('sha256', secret).update(String(expires)).digest('hex')}`;
}
export function validToken(token: string, secret: string, now = Date.now()) {
  const [expires, signature, extra] = token.split('.');
  return !extra && /^\d+$/.test(expires ?? '') && Number(expires) > now && !!signature && safeEqual(token, makeToken(secret, Number(expires)));
}
export function demoMode() { return !process.env.DATABASE_URL; }
export function requireAuthConfig() {
  if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 12 || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new AppError(503, 'Cấu hình APP_PASSWORD (ít nhất 12 ký tự) và SESSION_SECRET (ít nhất 32 ký tự) trước khi dùng database.', 'AUTH_NOT_CONFIGURED');
}
export async function authorize() {
  if (demoMode()) return;
  requireAuthConfig();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !validToken(token, process.env.SESSION_SECRET!)) throw new AppError(401, 'Vui lòng đăng nhập.', 'UNAUTHORIZED');
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new AppError(403, 'Yêu cầu phải xuất phát từ app.', 'ORIGIN_REJECTED');
}
