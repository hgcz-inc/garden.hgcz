import { z } from 'zod';
import { mutation } from '@/lib/mutations';
import { plantSchema } from '@/lib/validation';
import { body, failure, privateJson } from '@/lib/http';
export async function POST(request: Request) { try { const repo = await mutation(request); await repo.savePlant(plantSchema.parse(await body(request))); return privateJson({ ok: true }); } catch (error) { return failure(error); } }
export async function DELETE(request: Request) { try { const repo = await mutation(request); const input = z.object({ id: z.string().uuid(), restore: z.boolean().default(false) }).parse(await body(request)); await repo.archivePlant(input.id, input.restore); return privateJson({ ok: true }); } catch (error) { return failure(error); } }
