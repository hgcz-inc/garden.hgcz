import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../seed/garden.json';
import { baseline, boundsFor, buildContext, historyDecisions, makePlan, waterDates } from '../src/lib/planner';
import { addDays, today, validDate } from '../src/lib/dates';
import { blankPlant, recordDemo, undoDemo } from '../src/lib/demo';
import type { AppState, Seed, Weather } from '../src/lib/types';
const seed = data as Seed;
const start = '2026-10-04';
const weather: Weather = { source: 'test', fetchedAt: new Date().toISOString(), days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), rainMm: 0, rainProbability: 0, maxTemp: 20, windKmh: 10, et0: 2 })) };

test('All Excel plants and date histories are preserved; derived formulas stay separate', () => {
  assert.equal(seed.plants.length, 39); assert.equal(seed.events.length, 495);
  assert.equal(new Set(seed.plants.map(p => p.code)).size, 39);
  assert(seed.plants.every(p => Object.keys(p.legacyFields).length > 0));
  assert(seed.events.every(e => e.occurredAt === null && e.action === 'legacy_water_care' && e.sourceCell));
});
test('Auckland date and invalid calendar dates', () => {
  assert.equal(today(new Date('2026-10-03T12:30:00Z')), '2026-10-04');
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-09-05'), true);
});
test('History mode uses all-history mean; AI retains recent median', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-13'];
  assert.equal(baseline(days, 'history'), 4); assert.equal(baseline(days, 'ai'), 1);
});
test('History mode covers all selected plants without weather, tokens or AI adjustment', () => {
  const context = buildContext(seed.garden, seed.plants, seed.events, start, 'history');
  const decisions = historyDecisions(context);
  assert(decisions.every(d => d.earlyDays === 0 && d.rainDelayDays === 0));
  const result = makePlan(context, decisions, 'history', null, crypto.randomUUID());
  assert.equal(result.stats.plantCount, 39); assert.equal(result.weather, null); assert.equal(result.agent, undefined);
  assert(result.visits.every(v => v.date >= start && v.date <= addDays(start, 6)));
  const tasks = result.visits.flatMap(v => v.tasks);
  assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
  assert.equal(result.visits.find(v => v.date === start)?.tasks.find(t => t.code === 'P011')?.action, 'check_only');
  assert(tasks.filter(t => t.code === 'P004').every(t => t.action === 'check_water'));
});
test('Undo removes real watering from statistics; retries do not duplicate sessions', () => {
  const state: AppState = { ...seed, sessions: [], plans: [], storage: 'demo' };
  const p = seed.plants.find(p => p.code === 'P022')!;
  const input = { requestId: crypto.randomUUID(), occurredOn: today(), plantIds: [p.id], action: 'watered' as const, moisture: 'unknown' as const, notes: '' };
  const saved = recordDemo(state, input), retry = recordDemo(saved, input);
  assert.equal(retry.sessions.length, 1); assert.equal(retry.events.length, 496);
  const undone = undoDemo(saved, saved.sessions[0].id);
  assert.deepEqual(waterDates(p.id, undone.events, today()), waterDates(p.id, state.events, today()));
});
test('Empty history gives one initial check; future events are excluded', () => {
  const p = { ...blankPlant('NEW'), id: crypto.randomUUID(), name: 'Cây mới' };
  const context = buildContext(seed.garden, [p], [{ ...seed.events[0], id: crypto.randomUUID(), plantId: p.id, occurredOn: addDays(start, 1) }], start, 'history');
  const result = makePlan(context, historyDecisions(context), 'history', null, crypto.randomUUID());
  assert.equal(context.plants[0].history.length, 0); assert.equal(result.stats.taskCount, 1);
  assert(result.visits.every(v => v.tasks[0].action === 'check_only'));
});
test('Unavailable days never push overdue checks beyond their window', () => {
  const context = buildContext(seed.garden, seed.plants.filter(p => p.code === 'P011'), seed.events, start, 'history', [0]);
  assert.throws(() => makePlan(context, historyDecisions(context), 'history', null, crypto.randomUUID()), /Ngày bạn có thể/);
});
test('AI rejects missing weather, duplicate plants and rain delay for unknown rain exposure', () => {
  const context = buildContext(seed.garden, seed.plants.filter(p => p.code === 'P022'), seed.events, start, 'ai');
  const d = historyDecisions(context);
  assert.throws(() => makePlan(context, d, 'ai', null, crypto.randomUUID()), /thời tiết/);
  assert.throws(() => makePlan(context, [...d, ...d], 'ai', weather, crypto.randomUUID()), /mỗi cây/);
  assert.throws(() => makePlan(context, [{ ...d[0], rainDelayDays: 1 }], 'ai', weather, crypto.randomUUID()), /ngoài giới hạn/);
});
test('AI heat adjustment is bounded; history mode remains unchanged', () => {
  const context = buildContext(seed.garden, seed.plants.filter(p => p.code === 'P025'), seed.events, start, 'ai');
  const hot = { ...weather, days: weather.days.map(d => ({ ...d, maxTemp: 29 })) };
  const bounds = boundsFor(context.plants[0], context, hot);
  assert.equal(bounds.intervalMin, context.plants[0].intervalDays! - 1);
  assert.equal(bounds.earlyMax, 0); assert.equal(bounds.rainDelayMax, 0);
});
