import { defineConfig } from 'drizzle-kit';
import { toDirectUrl } from './scripts/lib/db-url';

const owner = process.env.DATABASE_URL_OWNER;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  // Migrations run as the owner on the direct (non-pooled) URL. `generate` needs no DB.
  dbCredentials: { url: owner ? toDirectUrl(owner) : '' },
});
