import { authorize, demoMode, sameOrigin } from './auth';
import { AppError } from './validation';
import { getDb } from '../db/client';
import { createRepository } from '../db/repository';
export async function mutation(request: Request) {
  sameOrigin(request); await authorize();
  if (demoMode()) throw new AppError(503, 'Chưa cấu hình Neon; chế độ xem thử chỉ lưu trên thiết bị.', 'DEMO_MODE');
  return createRepository(getDb());
}
