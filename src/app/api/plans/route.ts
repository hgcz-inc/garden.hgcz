import { authorize } from '@/lib/auth';
import { mutation } from '@/lib/mutations';
import { AppError, planSchema } from '@/lib/validation';
import { body, failure, privateJson } from '@/lib/http';
import { buildContext, historyDecisions, makePlan } from '@/lib/planner';
import { runAgent } from '@/lib/agent';
import { createRepository } from '@/db/repository';
import { getDb } from '@/db/client';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export async function GET() { try { await authorize(); const state = await createRepository(getDb()).state(); return privateJson(state.plans[0] ?? null); } catch (error) { return failure(error); } }
export async function POST(request: Request) {
  let pending: { id: string; repo: ReturnType<typeof createRepository> } | null = null;
  try {
    const repo = await mutation(request);
    const input = planSchema.parse(await body(request));
    const state = await repo.state();
    const plants = state.plants.filter(p => input.plantIds.includes(p.id) && !p.archivedAt);
    if (plants.length !== input.plantIds.length) throw new AppError(400, 'Danh sách cây có mục không hợp lệ.');
    if (input.mode === 'ai' && !process.env.OPENAI_API_KEY) throw new AppError(503, 'Thiếu OPENAI_API_KEY. Chọn Theo lịch sử hoặc cấu hình key trên server.', 'AI_NOT_CONFIGURED');
    const context = buildContext(state.garden, plants, state.events, input.start, input.mode, input.weekdays);
    const start = await repo.startPlan(input.requestId, input.mode, context);
    if (start.existing) return privateJson(start.existing);
    pending = { id: start.id, repo };
    const result = input.mode === 'history' ? makePlan(context, historyDecisions(context), 'history', null, start.id) : await runAgent(context, start.id);
    await repo.finishPlan(start.id, result, context);
    return privateJson(result);
  } catch (error) {
    if (pending) { try { await pending.repo.failPlan(pending.id, error instanceof AppError ? error.code : 'RUN_FAILED'); } catch { /* Stale-run cleanup handles lost connections. */ } }
    return failure(error);
  }
}
