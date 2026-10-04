import { test } from 'node:test';
import assert from 'node:assert/strict';
import data from '../seed/garden.json';
import { runAgent } from '../src/lib/agent';
import { buildContext, boundsFor } from '../src/lib/planner';
import { loadWeather } from '../src/lib/weather';
import { addDays, today } from '../src/lib/dates';
import { validToken, makeToken, sameOrigin } from '../src/lib/auth';
import type { Seed, Weather } from '../src/lib/types';
const seed = data as Seed;
const context = buildContext(seed.garden, seed.plants.filter(p => ['P022', 'P023', 'P024', 'P025', 'P026', 'P027'].includes(p.code)), seed.events, today(), 'ai');
const weather: Weather = { source: 'test', fetchedAt: new Date().toISOString(), days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(today(), i), rainMm: 0, rainProbability: 0, maxTemp: 20, windKmh: 10, et0: 2 })) };
test('Agent calls tools and returns only a code-validated finished plan', async () => {
  const planId = crypto.randomUUID();
  const steps = [
    ['get_decision_bounds', {}], // Deliberate out-of-order call is rejected.
    ['get_plants', {}], ['get_weather', {}], ['get_decision_bounds', {}],
    ['optimize_schedule', { decisions: context.plants.map(p => ({ plantId: p.id, intervalDays: boundsFor(p, context, weather).intervalMax, earlyDays: 0, rainDelayDays: 0, rationale: 'Kiểm tra theo lịch sử và hồ sơ cây.' })) }],
    ['finish_plan', { planId, summary: 'Lịch kiểm tra đã được tối ưu trong giới hạn.' }],
  ];
  let index = 0;
  const mock = (async (_url: unknown, init: RequestInit) => {
    const sent = JSON.parse(String(init.body)); assert.equal(sent.store, false); assert.equal(sent.parallel_tool_calls, false);
    const [name, args] = steps[index++];
    return Response.json({ status: 'completed', usage: { input_tokens: 10, output_tokens: 5 }, output: [{ type: 'function_call', call_id: `call-${index}`, name, arguments: JSON.stringify(args) }] });
  }) as typeof fetch;
  const result = await runAgent(context, planId, { key: 'test-key', fetcher: mock, weatherLoader: async () => weather });
  assert.equal(result.mode, 'ai'); assert.equal(result.id, planId); assert.equal(result.agent?.turns, 6);
  assert.equal(result.agent?.inputTokens, 60); assert.equal(result.agent?.trace[0].status, 'rejected');
});
test('OpenAI quota failure remains an error instead of silently switching modes', async () => {
  await assert.rejects(runAgent(context, crypto.randomUUID(), { key: 'test-key', fetcher: (async () => new Response('', { status: 429 })) as typeof fetch }), /quota/);
});
test('Missing forecast days cannot become an AI plan', async () => {
  await assert.rejects(loadWeather(context, (async () => Response.json({ daily: { time: [] } })) as typeof fetch), /thiếu dữ liệu/);
});
test('Signed sessions expire and cannot be forged; mutations reject another origin', () => {
  const secret = 'a'.repeat(40), token = makeToken(secret, 2000);
  assert.equal(validToken(token, secret, 1000), true); assert.equal(validToken(token, secret, 3000), false);
  assert.equal(validToken(token, 'b'.repeat(40), 1000), false);
  assert.throws(() => sameOrigin(new Request('https://garden.example/api/sessions', { headers: { origin: 'https://evil.example' } })), /xuất phát/);
});
