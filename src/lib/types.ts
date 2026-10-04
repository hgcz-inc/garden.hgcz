export type Mode = 'history' | 'ai';
export type Action = 'watered' | 'checked' | 'skipped' | 'water_changed' | 'water_topped_up' | 'legacy_water_care';
export type Moisture = 'unknown' | 'dry' | 'moist' | 'wet';
export interface Profile {
  growingMedium: 'soil' | 'water' | 'unknown';
  rainExposure: 'unknown' | 'none' | 'partial' | 'full';
  potSizeLitres: number | null;
  growthStage: string;
  maxEarlyDays: number;
  maxRainDelayDays: number;
  careNotes: string;
  sources: string[];
  species?: string;
}
export interface Plant {
  id: string; code: string; name: string;
  moisturePreference: string | null; wateringGuidance: string | null;
  lightPreference: string | null; statusLabel: string | null;
  positionLabel: string | null; naturalHabitat: string | null;
  profile: Profile; legacyFields: Record<string, unknown>; archivedAt: string | null;
}
export interface Group { id: string; name: string; kind: 'spreadsheet_category' | 'quick_entry'; plantIds: string[]; }
export interface Garden { id: string; name: string; timezone: string; locationName: string; latitude: number; longitude: number; }
export interface CareEvent {
  id: string; plantId: string; sessionId: string | null; action: Action;
  occurredOn: string; occurredAt: string | null; moisture: Moisture;
  notes: string | null; sourceCell: string | null; voidedAt: string | null;
}
export interface Session { id: string; requestId: string; occurredOn: string; occurredAt: string | null; createdAt?: string; notes: string | null; undoneAt: string | null; plantIds: string[]; action: Action; }
export interface SessionInput { requestId: string; occurredOn: string; action: Exclude<Action, 'legacy_water_care'>; plantIds: string[]; moisture: Moisture; notes: string; }
export interface Seed { garden: Garden; plants: Plant[]; groups: Group[]; events: CareEvent[]; }
export interface WeatherDay { date: string; rainMm: number; rainProbability: number; maxTemp: number; windKmh: number; et0: number | null; }
export interface Weather { source: string; fetchedAt: string; days: WeatherDay[]; }
export interface ContextPlant extends Plant { history: string[]; intervalDays: number | null; latestObservation: CareEvent | null; }
export interface Context { start: string; end: string; garden: Garden; plants: ContextPlant[]; weekdays: number[]; }
export interface Decision { plantId: string; intervalDays: number; earlyDays: number; rainDelayDays: number; rationale: string; }
export interface Bounds { intervalMin: number; intervalMax: number; earlyMax: number; rainDelayMax: number; }
export interface Task { id: string; plantId: string; code: string; name: string; action: 'check_then_water' | 'check_only' | 'check_water'; condition: string; targetDate: string; earliest: string; latest: string; scheduledOn: string; reasons: string[]; explanation: string; conditional: boolean; }
export interface Plan {
  id: string; mode: Mode; generatedAt: string; period: { start: string; end: string };
  timezone: string; visits: { date: string; tasks: Task[] }[];
  decisions: Decision[]; weather: Weather | null; summary: string;
  stats: { plantCount: number; taskCount: number; visitCount: number; baselineVisits: number };
  reviews: { plantId: string; message: string }[];
  agent?: { model: string; turns: number; inputTokens: number; outputTokens: number; trace: { tool: string; status: string }[] };
}
export interface AppState extends Seed { sessions: Session[]; plans: Plan[]; storage: 'demo' | 'neon'; setupError?: string; }
