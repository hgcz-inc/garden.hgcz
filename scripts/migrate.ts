import { config } from 'dotenv';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
config({ path: '.env.local', quiet: true }); config({ path: '.env', quiet: true });
if (!process.env.DATABASE_URL) { console.error('Thiếu DATABASE_URL trong .env.local hoặc .env.'); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }); console.log('Migration hoàn tất.'); }
catch { console.error('Migration thất bại. Kiểm tra kết nối và quyền database. Chi tiết kết nối không được in.'); process.exitCode = 1; }
finally { await pool.end(); }
