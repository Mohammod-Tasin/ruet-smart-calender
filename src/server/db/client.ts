import 'server-only';
import dns from 'node:dns';
import { Pool, neonConfig } from '@neondatabase/serverless';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { drizzle, type NeonQueryResultHKT } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

// Prefer IPv4 in Node.js to avoid 20+ second timeouts on networks with broken IPv6 routing to cloud DBs
try {
  dns.setDefaultResultOrder?.('ipv4first');
} catch {
  // Ignore in runtimes where setDefaultResultOrder is not supported
}

// Custom WebSocket that forces IPv4 so connection attempts do not hang on IPv6 blackholes
class FastWebSocket extends ws {
  constructor(
    address: string | URL,
    protocols?: string | string[] | ws.ClientOptions,
    options?: ws.ClientOptions,
  ) {
    let opts = options;
    let proto = protocols;
    if (typeof protocols === 'object' && protocols !== null && !Array.isArray(protocols)) {
      opts = protocols as ws.ClientOptions;
      proto = undefined;
    }
    opts = Object.assign({}, opts, { family: 4 });
    super(address, proto as string | string[] | undefined, opts);
  }
}

// The Neon driver needs a WebSocket implementation on the Node.js runtime.
neonConfig.webSocketConstructor = FastWebSocket;

const globalForDb = globalThis as unknown as {
  neonPool?: Pool;
  dbInstance?: ReturnType<typeof create>;
};

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const pool = (globalForDb.neonPool ??= new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  }));
  return drizzle(pool, { schema });
}

/** Lazy, so importing a route never needs a DB (keeps `next build` working in CI). Preserved on globalThis for Next.js hot-reloads. */
export function getDb() {
  return (globalForDb.dbInstance ??= create());
}

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the plain database or a transaction: both can select/insert/update/delete. */
export type Executor = PgDatabase<NeonQueryResultHKT, typeof schema>;
