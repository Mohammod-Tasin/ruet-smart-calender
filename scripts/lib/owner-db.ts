import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from '../../src/server/db/schema';
import { requireOwnerUrl, toDirectUrl } from './db-url';

neonConfig.webSocketConstructor = ws;

/** Owner connection (direct URL) for scripts only. Never used by the running app. */
export function connectAsOwner() {
  const pool = new Pool({ connectionString: toDirectUrl(requireOwnerUrl()) });
  return { pool, db: drizzle(pool, { schema }) };
}
