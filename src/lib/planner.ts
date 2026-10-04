import { addDays, diffDays, weekday } from './dates';
import type { Bounds, CareEvent, Context, ContextPlant, Decision, Garden, Plan, Plant, Task, Weather } from './types';

export function waterDates(plantId: string, events: CareEvent[], start: string) {
  return [...new Set(events.filter(e => e.plantId === plantId && !e.voidedAt && e.occurredOn <= start &&
    ['watered', 'legacy_water_care', 'water_changed', 'water_topped_up'].includes(e.action)).map(e => e.occurredOn))].sort();
}
export function baseline(history: string[], mode: 'history' | 'ai'): number | null {
  if (history.length < 2) return null;
  const gaps = history.slice(1).map((day, i) => diffDays(day, history[i]));
  if (mode === 'history') return Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length));
  const recent = gaps.slice(-6).sort((a, b) => a - b);
  const middle = Math.floor(recent.length / 2);
  const median = recent.length % 2 ? recent[middle] : (recent[middle - 1] + recent[middle]) / 2;
  return Math.max(1, Math.round(median));
}
export function buildContext(garden: Garden, plants: Plant[], events: CareEvent[], start: string, mode: 'history' | 'ai', weekdays = [0, 1, 2, 3, 4, 5, 6]): Context {
  return { start, end: addDays(start, 6), garden, weekdays, plants: plants.filter(p => !p.archivedAt).map(p => {
    const history = waterDates(p.id, events, start);
    const observations = events.filter(e => e.plantId === p.id && !e.voidedAt && e.occurredOn <= start)
      .sort((a, b) => `${a.occurredOn}:${a.occurredAt ?? ''}:${a.id}`.localeCompare(`${b.occurredOn}:${b.occurredAt ?? ''}:${b.id}`));
    return { ...p, history, intervalDays: baseline(history, mode), latestObservation: observations.at(-1) ?? null };
  }) };
}
export function boundsFor(plant: ContextPlant, context: Context, weather: Weather): Bounds {
  const base = plant.intervalDays ?? 1;
  const hotOrWindy = weather.days.some(d => d.date >= context.start && d.date <= context.end && (d.maxTemp >= 26 || d.windKmh >= 30));
  const dry = plant.latestObservation?.occurredOn === context.start && plant.latestObservation.moisture === 'dry' && plant.latestObservation.action !== 'watered';
  return { intervalMin: Math.max(1, base - (hotOrWindy || dry ? 1 : 0)), intervalMax: base,
    earlyMax: Math.min(plant.profile.maxEarlyDays, Math.floor((base - 1) / 2)),
    rainDelayMax: plant.profile.rainExposure === 'full' ? plant.profile.maxRainDelayDays : 0 };
}
export function historyDecisions(context: Context): Decision[] {
  return context.plants.map(p => ({ plantId: p.id, intervalDays: p.intervalDays ?? 1, earlyDays: 0, rainDelayDays: 0,
    rationale: p.intervalDays ? `Khoảng trung bình từ lịch sử: ${p.intervalDays} ngày. Kiểm tra trước khi tưới.` : 'Chưa đủ hai ngày lịch sử; chỉ đề xuất kiểm tra, chưa suy ra chu kỳ tưới.' }));
}
export function validateDecisions(context: Context, decisions: Decision[], mode: 'history' | 'ai', weather: Weather | null) {
  if (decisions.length !== context.plants.length || new Set(decisions.map(d => d.plantId)).size !== decisions.length) throw new Error('Cần đúng một quyết định cho mỗi cây.');
  for (const d of decisions) {
    const p = context.plants.find(p => p.id === d.plantId);
    if (!p) throw new Error('Quyết định chứa cây không thuộc lịch.');
    const b = mode === 'ai' && weather ? boundsFor(p, context, weather) : { intervalMin: p.intervalDays ?? 1, intervalMax: p.intervalDays ?? 1, earlyMax: 0, rainDelayMax: 0 };
    if (!Number.isInteger(d.intervalDays) || d.intervalDays < b.intervalMin || d.intervalDays > b.intervalMax ||
      !Number.isInteger(d.earlyDays) || d.earlyDays < 0 || d.earlyDays > b.earlyMax ||
      !Number.isInteger(d.rainDelayDays) || d.rainDelayDays < 0 || d.rainDelayDays > b.rainDelayMax ||
      typeof d.rationale !== 'string' || !d.rationale.trim() || d.rationale.length > 1500) throw new Error(`Quyết định ngoài giới hạn: ${p.code}`);
  }
}
export function makePlan(context: Context, decisions: Decision[], mode: 'history' | 'ai', weather: Weather | null, id: string): Plan {
  if (!context.plants.length) throw new Error('Hãy chọn ít nhất một cây.');
  if (mode === 'ai' && !weather) throw new Error('Chế độ AI cần thời tiết thực.');
  validateDecisions(context, decisions, mode, weather);
  const tasks: Task[] = [], reviews: Plan['reviews'] = [];
  for (const p of context.plants) {
    const d = decisions.find(d => d.plantId === p.id)!;
    const last = p.history.at(-1);
    const original = last && p.intervalDays ? addDays(last, d.intervalDays) : context.start;
    let target = original < context.start ? context.start : original;
    const obs = p.latestObservation;
    const fresh = mode === 'ai' && obs?.occurredOn === context.start;
    const dry = fresh && obs.moisture === 'dry' && obs.action !== 'watered';
    const moist = fresh && ['moist', 'wet'].includes(obs.moisture) && obs.action !== 'watered';
    if (dry) target = context.start;
    if (moist && target <= context.start) target = addDays(context.start, 1);
    if (!p.intervalDays) reviews.push({ plantId: p.id, message: 'Chưa đủ lịch sử để suy ra chu kỳ tưới.' });
    if (original < context.start) reviews.push({ plantId: p.id, message: `Mốc lịch sử ${original} đã qua; kiểm tra tình trạng thực tế.` });
    if (mode === 'ai' && (p.profile.rainExposure === 'unknown' || p.profile.growingMedium === 'unknown' || !p.profile.potSizeLitres)) reviews.push({ plantId: p.id, message: 'Hồ sơ còn thiếu thông tin: mức nhận mưa, môi trường trồng hoặc kích thước chậu.' });
    let occurrence = 0;
    while (target <= context.end) {
      const reasons = [p.intervalDays ? 'HISTORY_BASELINE' : 'INSUFFICIENT_HISTORY'];
      const dueNow = occurrence === 0 && (original < context.start || dry) && !moist;
      let earliest = addDays(target, -Math.min(d.earlyDays, Math.floor((d.intervalDays - 1) / 2)));
      if (earliest < context.start) earliest = context.start;
      if (last && p.intervalDays && earliest <= last) earliest = addDays(last, 1);
      let latest = target;
      if (dueNow) { earliest = latest = context.start; reasons.push(dry ? 'OBSERVED_DRY' : 'CHECK_NOW'); }
      if (moist && occurrence === 0) { if (earliest <= context.start) earliest = addDays(context.start, 1); reasons.push('OBSERVED_MOIST_RECHECK'); }
      const dayWeather = weather?.days.find(w => w.date === target);
      if (dayWeather && dayWeather.rainMm >= 5 && dayWeather.rainProbability >= 70) {
        reasons.push('RAIN_FORECAST_CHECK_SOIL');
        if (!dueNow && !dry && d.rainDelayDays) {
          latest = addDays(target, Math.min(d.rainDelayDays, Math.floor((d.intervalDays - 1) / 2)));
          if (latest > context.end) latest = context.end;
        }
      }
      if (dayWeather && dayWeather.maxTemp >= 26) reasons.push('HOT_DAY');
      if (dayWeather && dayWeather.windKmh >= 30) reasons.push('WINDY_DAY');
      tasks.push({ id: `${p.id}:${occurrence}`, plantId: p.id, code: p.code, name: p.name,
        action: p.profile.growingMedium === 'water' ? 'check_water' : p.intervalDays ? 'check_then_water' : 'check_only',
        condition: p.wateringGuidance ?? 'Kiểm tra tình trạng thực tế trước khi quyết định chăm sóc.',
        targetDate: target, earliest, latest, scheduledOn: target, reasons, explanation: d.rationale, conditional: occurrence > 0 });
      // No measured interval: one initial check, not an invented daily care cycle.
      if (!p.intervalDays) break;
      occurrence++;
      target = addDays(target, d.intervalDays);
    }
  }
  const days = Array.from({ length: 7 }, (_, i) => addDays(context.start, i)).filter(d => context.weekdays.includes(weekday(d)));
  let best: { score: number[]; assignments: string[] } | null = null;
  for (let mask = 0; mask < (1 << days.length); mask++) {
    const selected = days.filter((_, i) => mask & (1 << i));
    const assignments: string[] = [];
    let late = 0, movement = 0, feasible = true;
    for (const task of tasks) {
      const choices = selected.filter(day => day >= task.earliest && day <= task.latest).sort((a, b) =>
        Math.max(0, diffDays(a, task.targetDate)) - Math.max(0, diffDays(b, task.targetDate)) ||
        Math.abs(diffDays(a, task.targetDate)) - Math.abs(diffDays(b, task.targetDate)) || a.localeCompare(b));
      if (!choices.length) { feasible = false; break; }
      assignments.push(choices[0]); late += Math.max(0, diffDays(choices[0], task.targetDate)); movement += Math.abs(diffDays(choices[0], task.targetDate));
    }
    const score = [selected.length, late, movement, mask];
    const better = !best || score.some((v, i) => v < best!.score[i] && score.slice(0, i).every((n, j) => n === best!.score[j]));
    if (feasible && better) best = { score, assignments };
  }
  if (!best) throw new Error('Ngày bạn có thể vào vườn không đáp ứng các khoảng kiểm tra. Hãy chọn thêm ngày.');
  const visits = new Map<string, Task[]>();
  tasks.forEach((t, i) => {
    t.scheduledOn = best!.assignments[i];
    if (t.scheduledOn !== t.targetDate) t.reasons.push(t.scheduledOn < t.targetDate ? 'GROUPED_EARLY' : 'GROUPED_AFTER_FORECAST_RAIN');
    const list = visits.get(t.scheduledOn) ?? [];
    if (list.some(existing => existing.plantId === t.plantId)) throw new Error('Hai công việc của cùng cây bị gom vào một ngày.');
    list.push(t); visits.set(t.scheduledOn, list);
  });
  return { id, mode, generatedAt: new Date().toISOString(), period: { start: context.start, end: context.end }, timezone: context.garden.timezone,
    visits: [...visits].sort(([a], [b]) => a.localeCompare(b)).map(([date, tasks]) => ({ date, tasks })),
    decisions, weather, summary: mode === 'history' ? 'Lịch 7 ngày dựa trên khoảng tưới trung bình đã ghi nhận. Các lần sau giả định lần trước đã được thực hiện.' : '',
    stats: { plantCount: context.plants.length, taskCount: tasks.length, visitCount: visits.size, baselineVisits: new Set(tasks.map(t => t.targetDate)).size }, reviews };
}
