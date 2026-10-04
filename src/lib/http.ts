import { ZodError } from 'zod';
import { AppError, databaseErrorCode } from './validation';
export async function body(request: Request) {
  const raw = await request.text();
  if (raw.length > 50000) throw new AppError(413, 'Dữ liệu gửi lên quá lớn.');
  try { return JSON.parse(raw); } catch { throw new AppError(400, 'JSON không hợp lệ.'); }
}
export function failure(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? 'Dữ liệu không hợp lệ.', code: 'VALIDATION' }, { status: 400 });
  // Never forward driver messages or OpenAI request headers/secrets to browsers or logs.
  const code = databaseErrorCode(error);
  if (code === '23505') return Response.json({ error: 'Mã hoặc tên này đã tồn tại, hoặc một lịch đang được tạo.', code: 'CONFLICT' }, { status: 409 });
  console.error('GardenCare operation failed', { category: error instanceof Error ? error.name : 'UnknownError' });
  return Response.json({ error: 'Không hoàn tất được. Kiểm tra kết nối database và migration, rồi thử lại.', code: 'SERVER_ERROR' }, { status: 503 });
}
export function privateJson(data: unknown) { return Response.json(data, { headers: { 'Cache-Control': 'no-store' } }); }
