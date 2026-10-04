import { pgTable, uuid, text, timestamp, doublePrecision, date, jsonb, integer, primaryKey, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Profile, Plan, Context, Weather } from '../lib/types';

export const gardens = pgTable('gardens', {
  id: uuid('id').primaryKey(), name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Pacific/Auckland'),
  locationName: text('location_name').notNull(), latitude: doublePrecision('latitude').notNull(), longitude: doublePrecision('longitude').notNull(),
});
export const plants = pgTable('plants', {
  id: uuid('id').primaryKey(), gardenId: uuid('garden_id').notNull().references(() => gardens.id),
  code: text('code').notNull(), name: text('name').notNull(), moisturePreference: text('moisture_preference'),
  wateringGuidance: text('watering_guidance'), lightPreference: text('light_preference'),
  statusLabel: text('status_label'), positionLabel: text('position_label'), naturalHabitat: text('natural_habitat'),
  profile: jsonb('profile').$type<Profile>().notNull(),
  legacyFields: jsonb('legacy_fields').$type<Record<string, unknown>>().notNull().default({}),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
}, t => [uniqueIndex('plant_code_unique').on(t.gardenId, t.code)]);
export const groups = pgTable('plant_groups', {
  id: uuid('id').primaryKey(), gardenId: uuid('garden_id').notNull().references(() => gardens.id),
  name: text('name').notNull(), kind: text('kind', { enum: ['spreadsheet_category', 'quick_entry'] }).notNull(),
}, t => [uniqueIndex('group_name_unique').on(t.gardenId, t.name, t.kind)]);
export const members = pgTable('plant_group_members', {
  groupId: uuid('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  plantId: uuid('plant_id').notNull().references(() => plants.id),
}, t => [primaryKey({ columns: [t.groupId, t.plantId] })]);
export const sessions = pgTable('care_sessions', {
  id: uuid('id').primaryKey(), gardenId: uuid('garden_id').notNull().references(() => gardens.id),
  requestId: uuid('request_id').notNull(), occurredOn: date('occurred_on').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }),
  notes: text('notes'), createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  undoneAt: timestamp('undone_at', { withTimezone: true, mode: 'string' }),
}, t => [uniqueIndex('session_request_unique').on(t.gardenId, t.requestId)]);
export const events = pgTable('care_events', {
  id: uuid('id').primaryKey(), plantId: uuid('plant_id').notNull().references(() => plants.id),
  sessionId: uuid('session_id').references(() => sessions.id),
  action: text('action', { enum: ['watered', 'checked', 'skipped', 'water_changed', 'water_topped_up', 'legacy_water_care'] }).notNull(),
  occurredOn: date('occurred_on').notNull(), occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }),
  moisture: text('moisture', { enum: ['unknown', 'dry', 'moist', 'wet'] }).notNull().default('unknown'),
  notes: text('notes'), sourceCell: text('source_cell'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  voidedAt: timestamp('voided_at', { withTimezone: true, mode: 'string' }),
}, t => [index('care_history').on(t.plantId, t.occurredOn), uniqueIndex('session_plant_unique').on(t.sessionId, t.plantId),
  check('event_action_valid', sql`${t.action} IN ('watered','checked','skipped','water_changed','water_topped_up','legacy_water_care')`),
  check('event_moisture_valid', sql`${t.moisture} IN ('unknown','dry','moist','wet')`)]);
export const plans = pgTable('watering_plans', {
  id: uuid('id').primaryKey(), gardenId: uuid('garden_id').notNull().references(() => gardens.id),
  requestId: uuid('request_id').notNull(), mode: text('mode', { enum: ['history', 'ai'] }).notNull(),
  startsOn: date('starts_on').notNull(), status: text('status', { enum: ['generating', 'ready', 'failed'] }).notNull(),
  inputSnapshot: jsonb('input_snapshot').$type<{ context: Context; weather?: Weather }>().notNull(),
  result: jsonb('result').$type<Plan>(), errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, t => [uniqueIndex('plan_request_unique').on(t.gardenId, t.requestId),
  uniqueIndex('one_active_plan').on(t.gardenId).where(sql`${t.status} = 'generating'`),
  index('recent_plans').on(t.gardenId, t.createdAt),
  check('plan_mode_valid', sql`${t.mode} IN ('history','ai')`),
  check('plan_status_valid', sql`${t.status} IN ('generating','ready','failed')`)]);
