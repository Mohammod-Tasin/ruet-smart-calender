import 'server-only';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// The Neon driver needs a WebSocket implementation on the Node.js runtime.
neonConfig.webSocketConstructor = ws;

let instance: ReturnType<typeof create> | undefined;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(new Pool({ connectionString: url }), { schema });
}

/** Lazy, so importing a route never needs a DB (keeps `next build` working in CI). */
export function getDb() {
  return (instance ??= create());
}
