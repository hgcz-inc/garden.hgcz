import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import type { AppState, Context, Plan, Seed, SessionInput } from '../lib/types';
import { AppError, databaseErrorCode, groupSchema, plantSchema, gardenSchema } from '../lib/validation';
import { today } from '../lib/dates';
import type { z } from 'zod';

export function createRepository(db: NodePgDatabase<typeof schema>) {
  async function garden() {
    const [value] = await db.select().from(schema.gardens).limit(1);
    if (!value) throw new AppError(503, 'Database chưa có dữ liệu. Chạy npm run db:seed.', 'SEED_REQUIRED');
    return value;
  }
  async function state(): Promise<AppState> {
    const g = await garden();
    const [plants, groups, sessions, readyPlans] = await Promise.all([
      db.select().from(schema.plants).where(eq(schema.plants.gardenId, g.id)).orderBy(asc(schema.plants.code)),
      db.select().from(schema.groups).where(eq(schema.groups.gardenId, g.id)),
      db.select().from(schema.sessions).where(eq(schema.sessions.gardenId, g.id)).orderBy(desc(schema.sessions.createdAt)).limit(100),
      db.select().from(schema.plans).where(and(eq(schema.plans.gardenId, g.id), eq(schema.plans.status, 'ready'))).orderBy(desc(schema.plans.createdAt)).limit(10),
    ]);
    const plantIds = plants.map(p => p.id);
    const events = plantIds.length ? await db.select().from(schema.events).where(inArray(schema.events.plantId, plantIds)) : [];
    const membership = groups.length ? await db.select().from(schema.members).where(inArray(schema.members.groupId, groups.map(g => g.id))) : [];
    return { garden: g, plants, events, groups: groups.map(g => ({ ...g, plantIds: membership.filter(m => m.groupId === g.id).map(m => m.plantId) })),
      sessions: sessions.map(s => { const rows = events.filter(e => e.sessionId === s.id); return { ...s, plantIds: rows.map(e => e.plantId), action: rows[0]?.action ?? 'checked' }; }),
      plans: readyPlans.flatMap(p => p.result ? [p.result] : []), storage: 'neon' };
  }
  async function record(input: SessionInput) {
    const g = await garden();
    if (input.occurredOn > today(new Date(), g.timezone)) throw new AppError(400, 'Không ghi nhận chăm sóc trong tương lai.');
    return db.transaction(async tx => {
      async function duplicateResult(existing: typeof schema.sessions.$inferSelect) {
        const rows = await tx.select().from(schema.events).where(eq(schema.events.sessionId, existing.id));
        const samePlants = JSON.stringify(rows.map(e => e.plantId).sort()) === JSON.stringify([...input.plantIds].sort());
        if (existing.occurredOn !== input.occurredOn || (existing.notes ?? '') !== input.notes || !samePlants ||
          rows.some(e => e.action !== input.action || e.moisture !== input.moisture))
          throw new AppError(409, 'Yêu cầu trước đã lưu nội dung khác. Kiểm tra nhật ký trước khi ghi nhận tiếp.', 'IDEMPOTENCY_MISMATCH');
        return { id: existing.id, duplicate: true, undone: !!existing.undoneAt };
      }
      const [existing] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.gardenId, g.id), eq(schema.sessions.requestId, input.requestId)));
      if (existing) return duplicateResult(existing);
      const selected = await tx.select().from(schema.plants).where(and(eq(schema.plants.gardenId, g.id), inArray(schema.plants.id, input.plantIds), isNull(schema.plants.archivedAt)));
      if (selected.length !== input.plantIds.length) throw new AppError(400, 'Một số cây không tồn tại hoặc đã được lưu trữ.');
      if (input.action === 'watered' && selected.some(p => p.profile.growingMedium === 'water')) throw new AppError(400, 'Cây thủy sinh: chọn Châm nước hoặc Thay nước.');
      if (['water_changed', 'water_topped_up'].includes(input.action) && selected.some(p => p.profile.growingMedium !== 'water')) throw new AppError(400, 'Châm/thay nước chỉ áp dụng cho cây có môi trường trồng thủy sinh.');
      const id = randomUUID();
      const occurredAt = input.occurredOn === today(new Date(), g.timezone) ? new Date().toISOString() : null;
      const inserted = await tx.insert(schema.sessions).values({ id, gardenId: g.id, requestId: input.requestId, occurredOn: input.occurredOn, occurredAt, notes: input.notes || null }).onConflictDoNothing().returning();
      if (!inserted.length) {
        const [retry] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.gardenId, g.id), eq(schema.sessions.requestId, input.requestId)));
        return duplicateResult(retry);
      }
      await tx.insert(schema.events).values(input.plantIds.map(plantId => ({ id: randomUUID(), plantId, sessionId: id, action: input.action, occurredOn: input.occurredOn, occurredAt, moisture: input.moisture, notes: input.notes || null })));
      return { id, duplicate: false, undone: false };
    });
  }
  async function undo(id: string) {
    const g = await garden();
    await db.transaction(async tx => {
      const [s] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.id, id), eq(schema.sessions.gardenId, g.id)));
      if (!s) throw new AppError(404, 'Không tìm thấy buổi chăm sóc.');
      if (s.undoneAt) return;
      const at = new Date().toISOString();
      await tx.update(schema.sessions).set({ undoneAt: at }).where(eq(schema.sessions.id, id));
      await tx.update(schema.events).set({ voidedAt: at }).where(eq(schema.events.sessionId, id));
    });
  }
  async function savePlant(input: z.infer<typeof plantSchema>) {
    const g = await garden();
    if (input.id) {
      const result = await db.update(schema.plants).set(input).where(and(eq(schema.plants.id, input.id), eq(schema.plants.gardenId, g.id))).returning();
      if (!result.length) throw new AppError(404, 'Không tìm thấy cây.');
    } else await db.insert(schema.plants).values({ ...input, id: randomUUID(), gardenId: g.id });
  }
  async function archivePlant(id: string, restore = false) {
    const g = await garden();
    const result = await db.update(schema.plants).set({ archivedAt: restore ? null : new Date().toISOString() }).where(and(eq(schema.plants.id, id), eq(schema.plants.gardenId, g.id))).returning();
    if (!result.length) throw new AppError(404, 'Không tìm thấy cây.');
  }
  async function saveGroup(input: z.infer<typeof groupSchema>) {
    const g = await garden();
    await db.transaction(async tx => {
      if (input.plantIds.length) {
        const valid = await tx.select().from(schema.plants).where(and(eq(schema.plants.gardenId, g.id), inArray(schema.plants.id, input.plantIds), isNull(schema.plants.archivedAt)));
        if (valid.length !== input.plantIds.length) throw new AppError(400, 'Nhóm có cây không hợp lệ.');
      }
      const id = input.id ?? randomUUID();
      if (input.id) {
        const found = await tx.update(schema.groups).set({ name: input.name }).where(and(eq(schema.groups.id, id), eq(schema.groups.gardenId, g.id))).returning();
        if (!found.length) throw new AppError(404, 'Không tìm thấy nhóm.');
        await tx.delete(schema.members).where(eq(schema.members.groupId, id));
      } else await tx.insert(schema.groups).values({ id, gardenId: g.id, name: input.name, kind: 'quick_entry' });
      if (input.plantIds.length) await tx.insert(schema.members).values(input.plantIds.map(plantId => ({ plantId, groupId: id })));
    });
  }
  async function deleteGroup(id: string) { const g = await garden(); await db.delete(schema.groups).where(and(eq(schema.groups.id, id), eq(schema.groups.gardenId, g.id))); }
  async function saveGarden(input: z.infer<typeof gardenSchema>) { const g = await garden(); await db.update(schema.gardens).set(input).where(eq(schema.gardens.id, g.id)); }
  async function startPlan(requestId: string, mode: 'history' | 'ai', context: Context) {
    const g = await garden();
    const [existing] = await db.select().from(schema.plans).where(and(eq(schema.plans.gardenId, g.id), eq(schema.plans.requestId, requestId)));
    if (existing) {
      if (existing.status === 'ready' && existing.result) return { id: existing.id, existing: existing.result };
      throw new AppError(409, existing.status === 'generating' ? 'Lịch này đang được tạo. Chờ một chút rồi tải lại.' : 'Lần tạo trước thất bại. Bấm tạo lại để bắt đầu lượt mới.', 'PLAN_IN_PROGRESS');
    }
    await db.update(schema.plans).set({ status: 'failed', errorCode: 'STALE_RUN' }).where(and(eq(schema.plans.gardenId, g.id), eq(schema.plans.status, 'generating'), lt(schema.plans.createdAt, new Date(Date.now() - 300000).toISOString())));
    const id = randomUUID();
    try {
      await db.insert(schema.plans).values({ id, gardenId: g.id, requestId, mode, startsOn: context.start, status: 'generating', inputSnapshot: { context } });
    } catch (error) {
      if (databaseErrorCode(error) === '23505') throw new AppError(409, 'Một lịch đang được tạo. Chờ hoàn tất rồi thử lại.', 'PLAN_IN_PROGRESS');
      throw error;
    }
    return { id, existing: null };
  }
  async function finishPlan(id: string, result: Plan, context: Context) { await db.update(schema.plans).set({ status: 'ready', result, inputSnapshot: { context, ...(result.weather ? { weather: result.weather } : {}) } }).where(eq(schema.plans.id, id)); }
  async function failPlan(id: string, errorCode: string) { await db.update(schema.plans).set({ status: 'failed', errorCode }).where(eq(schema.plans.id, id)); }
  async function seed(data: Seed) {
    await db.transaction(async tx => {
      await tx.insert(schema.gardens).values(data.garden).onConflictDoNothing();
      await tx.insert(schema.plants).values(data.plants.map(p => ({ ...p, gardenId: data.garden.id }))).onConflictDoNothing();
      for (const g of data.groups) {
        await tx.insert(schema.groups).values({ id: g.id, gardenId: data.garden.id, name: g.name, kind: g.kind }).onConflictDoNothing();
        if (g.plantIds.length) await tx.insert(schema.members).values(g.plantIds.map(plantId => ({ groupId: g.id, plantId }))).onConflictDoNothing();
      }
      // Stable source UUIDs make re-running seed safe, including after undoing newer sessions.
      for (let i = 0; i < data.events.length; i += 100) await tx.insert(schema.events).values(data.events.slice(i, i + 100)).onConflictDoNothing();
    });
  }
  return { state, record, undo, savePlant, archivePlant, saveGroup, deleteGroup, saveGarden, startPlan, finishPlan, failPlan, seed };
}
