import { z } from 'zod';
import { mutation } from '@/lib/mutations';
import { groupSchema } from '@/lib/validation';
import { body, failure, privateJson } from '@/lib/http';
export async function POST(request: Request) { try { const repo = await mutation(request); await repo.saveGroup(groupSchema.parse(await body(request))); return privateJson({ ok: true }); } catch (error) { return failure(error); } }
export async function DELETE(request: Request) { try { const repo = await mutation(request); const { id } = z.object({ id: z.string().uuid() }).parse(await body(request)); await repo.deleteGroup(id); return privateJson({ ok: true }); } catch (error) { return failure(error); } }
