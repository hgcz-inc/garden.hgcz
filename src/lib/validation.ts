import { z } from 'zod';
import { validDate } from './dates';
export const dateSchema = z.string().refine(validDate, 'Ngày không hợp lệ.');
export const profileSchema = z.object({
  growingMedium: z.enum(['soil', 'water', 'unknown']), rainExposure: z.enum(['unknown', 'none', 'partial', 'full']),
  potSizeLitres: z.number().positive().max(10000).nullable(), growthStage: z.string().max(100),
  maxEarlyDays: z.number().int().min(0).max(1), maxRainDelayDays: z.number().int().min(0).max(1),
  careNotes: z.string().max(2000), sources: z.array(z.string().url().refine(s => /^https?:\/\//.test(s))).max(10), species: z.string().max(200).optional(),
});
export const plantSchema = z.object({
  id: z.string().uuid().optional(), code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(1).max(250),
  moisturePreference: z.string().max(1000).nullable(), wateringGuidance: z.string().max(2000).nullable(),
  lightPreference: z.string().max(1000).nullable(), statusLabel: z.string().max(200).nullable(),
  positionLabel: z.string().max(100).nullable(), naturalHabitat: z.string().max(1000).nullable(), profile: profileSchema,
});
export const sessionSchema = z.object({
  requestId: z.string().uuid(), occurredOn: dateSchema,
  action: z.enum(['watered', 'checked', 'skipped', 'water_changed', 'water_topped_up']),
  plantIds: z.array(z.string().uuid()).min(1).max(150).refine(ids => new Set(ids).size === ids.length, 'Cây bị chọn trùng.'),
  moisture: z.enum(['unknown', 'dry', 'moist', 'wet']).default('unknown'), notes: z.string().trim().max(2000).default(''),
});
export const planSchema = z.object({
  requestId: z.string().uuid(), mode: z.enum(['history', 'ai']), start: dateSchema,
  plantIds: z.array(z.string().uuid()).min(1).max(150).refine(ids => new Set(ids).size === ids.length),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length).default([0, 1, 2, 3, 4, 5, 6]),
});
export const groupSchema = z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(150), plantIds: z.array(z.string().uuid()).max(150).refine(ids => new Set(ids).size === ids.length) });
export const gardenSchema = z.object({ name: z.string().trim().min(1).max(150), locationName: z.string().trim().min(1).max(200), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });
export class AppError extends Error { constructor(public status: number, message: string, public code = 'VALIDATION') { super(message); } }
export function databaseErrorCode(error: unknown): string | undefined {
  let item = error;
  for (let depth = 0; depth < 5 && item && typeof item === 'object'; depth++) {
    const value = item as { code?: unknown; cause?: unknown };
    if (typeof value.code === 'string') return value.code;
    item = value.cause;
  }
}
