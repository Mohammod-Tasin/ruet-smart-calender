import { randomBytes } from 'node:crypto';
import { connectAsOwner } from './lib/owner-db';
import { requireOwnerUrl, toPooledUrl } from './lib/db-url';

// --revoke-only: just re-apply the audit_log revoke (db:migrate runs this after every migration).
const revokeOnly = process.argv.includes('--revoke-only');
const ROLE = 'app_user';

async function main() {
  const { pool } = connectAsOwner();
  try {
    const exists = (await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE])).rowCount;

    if (revokeOnly) {
      if (!exists) return console.log(`${ROLE} does not exist yet; skipping revoke.`);
      await pool.query(`REVOKE UPDATE, DELETE ON audit_log FROM ${ROLE}`);
      return console.log('Re-applied: audit_log is append-only for app_user.');
    }

    // Hex only, so it is safe to inline (CREATE/ALTER ROLE cannot take bind parameters).
    const password = randomBytes(24).toString('hex');
    await pool.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ROLE} LOGIN PASSWORD '${password}'`);

    const dbName = (await pool.query('SELECT current_database() AS d')).rows[0].d as string;
    for (const sql of [
      `GRANT CONNECT ON DATABASE "${dbName}" TO ${ROLE}`,
      `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
      `REVOKE UPDATE, DELETE ON audit_log FROM ${ROLE}`,
    ]) {
      await pool.query(sql);
    }

    const u = new URL(toPooledUrl(requireOwnerUrl()));
    u.username = ROLE;
    u.password = password;
    console.log(
      `${exists ? 'Reset password for' : 'Created'} ${ROLE}. Paste this into .env.local:\n`,
    );
    console.log(`DATABASE_URL=${u.toString()}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
