import type { AppState, Plant, SessionInput } from './types';
import { today } from './dates';
import { sessionSchema } from './validation';
export function recordDemo(state: AppState, raw: SessionInput): AppState {
  const input = sessionSchema.parse(raw);
  if (input.occurredOn > today()) throw new Error('Không ghi nhận chăm sóc trong tương lai.');
  if (state.sessions.some(s => s.requestId === input.requestId)) return state;
  const plants = state.plants.filter(p => input.plantIds.includes(p.id) && !p.archivedAt);
  if (plants.length !== input.plantIds.length) throw new Error('Danh sách cây không hợp lệ.');
  if (input.action === 'watered' && plants.some(p => p.profile.growingMedium === 'water')) throw new Error('Cây thủy sinh: chọn Châm nước hoặc Thay nước.');
  if (['water_changed', 'water_topped_up'].includes(input.action) && plants.some(p => p.profile.growingMedium !== 'water')) throw new Error('Châm/thay nước chỉ áp dụng cho cây thủy sinh.');
  const id = crypto.randomUUID();
  const occurredAt = input.occurredOn === today() ? new Date().toISOString() : null;
  return { ...state, sessions: [{ id, requestId: input.requestId, occurredOn: input.occurredOn, occurredAt, createdAt: new Date().toISOString(), notes: input.notes || null, undoneAt: null, plantIds: input.plantIds, action: input.action }, ...state.sessions],
    events: [...state.events, ...input.plantIds.map(plantId => ({ id: crypto.randomUUID(), plantId, sessionId: id, action: input.action, occurredOn: input.occurredOn, occurredAt, moisture: input.moisture, notes: input.notes || null, sourceCell: null, voidedAt: null }))] };
}
export function undoDemo(state: AppState, id: string): AppState {
  const now = new Date().toISOString();
  return { ...state, sessions: state.sessions.map(s => s.id === id ? { ...s, undoneAt: now } : s), events: state.events.map(e => e.sessionId === id ? { ...e, voidedAt: now } : e) };
}
export function blankPlant(code: string): Plant {
  return { id: '', code, name: '', moisturePreference: '', wateringGuidance: '', lightPreference: '', statusLabel: '', positionLabel: 'Outdoor', naturalHabitat: '', legacyFields: {}, archivedAt: null,
    profile: { growingMedium: 'unknown', rainExposure: 'unknown', potSizeLitres: null, growthStage: 'unknown', maxEarlyDays: 0, maxRainDelayDays: 0, careNotes: '', sources: [] } };
}
