import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
let pool: Pool | undefined;
let database: NodePgDatabase<typeof schema> | undefined;
export function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  if (!database) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    pool.on('error', () => console.error('Database connection interrupted'));
    database = drizzle(pool, { schema });
  }
  return database;
}
