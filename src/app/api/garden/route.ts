import { mutation } from '@/lib/mutations';
import { gardenSchema } from '@/lib/validation';
import { body, failure, privateJson } from '@/lib/http';
export async function POST(request: Request) { try { const repo = await mutation(request); await repo.saveGarden(gardenSchema.parse(await body(request))); return privateJson({ ok: true }); } catch (error) { return failure(error); } }
