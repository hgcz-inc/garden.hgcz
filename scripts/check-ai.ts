import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import data from '../seed/garden.json';
import { buildContext } from '../src/lib/planner';
import { runAgent } from '../src/lib/agent';
import { today } from '../src/lib/dates';
import { AppError } from '../src/lib/validation';
import type { Seed } from '../src/lib/types';
config({ path: '.env.local', quiet: true }); config({ path: '.env', quiet: true });
const seed = data as Seed;
const plants = seed.plants.filter(p => ['P022', 'P023', 'P024', 'P025', 'P026', 'P027'].includes(p.code));
try {
  const result = await runAgent(buildContext(seed.garden, plants, seed.events, today(), 'ai'), randomUUID());
  console.log(JSON.stringify({ mode: result.mode, ...result.stats, model: result.agent?.model, turns: result.agent?.turns, inputTokens: result.agent?.inputTokens, outputTokens: result.agent?.outputTokens, trace: result.agent?.trace }, null, 2));
} catch (error) {
  console.error(error instanceof AppError ? `${error.code}: ${error.message}` : 'Không hoàn tất kiểm tra AI.');
  process.exitCode = 1;
}
