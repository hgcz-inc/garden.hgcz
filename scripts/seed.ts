import { config } from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createRepository } from '../src/db/repository';
import * as schema from '../src/db/schema';
import data from '../seed/garden.json';
import type { Seed } from '../src/lib/types';
config({ path: '.env.local', quiet: true }); config({ path: '.env', quiet: true });
if (!process.env.DATABASE_URL) { console.error('Thiếu DATABASE_URL trong .env.local hoặc .env.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try { await createRepository(drizzle(pool, { schema })).seed(data as Seed); console.log('Đã import 39 mục cây, 495 ngày chăm sóc và 6 nhóm. Chạy lại không tạo trùng.'); }
catch { console.error('Import thất bại. Chạy migration trước và kiểm tra kết nối.'); process.exitCode = 1; }
finally { await pool.end(); }
