import data from '../../../../seed/garden.json';
import { authorize, demoMode } from '@/lib/auth';
import { failure, privateJson } from '@/lib/http';
import { getDb } from '@/db/client';
import { createRepository } from '@/db/repository';
import type { Seed } from '@/lib/types';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { await authorize(); if (demoMode()) return privateJson({ ...(data as Seed), sessions: [], plans: [], storage: 'demo' });
    return privateJson(await createRepository(getDb()).state());
  } catch (error) { return failure(error); }
}
