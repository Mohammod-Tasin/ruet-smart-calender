import { createInterface } from 'node:readline/promises';
import { hash } from '@node-rs/argon2'; // argon2id by default
import { admins } from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';
import { askHidden } from './lib/prompt';

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const name = (await rl.question('Name: ')).trim();
  const email = (await rl.question('Email: ')).trim().toLowerCase();
  rl.close();
  if (!name || !email.includes('@')) throw new Error('A name and a valid email are required.');

  const password = await askHidden('Password (min 10 chars): ');
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');
  if (password !== (await askHidden('Repeat password: '))) throw new Error('Passwords differ.');

  const { db, pool } = connectAsOwner();
  try {
    const [row] = await db
      .insert(admins)
      .values({ name, email, passwordHash: await hash(password), role: 'SUPER_ADMIN' })
      .onConflictDoNothing()
      .returning({ id: admins.id });
    console.log(row ? `Created SUPER_ADMIN ${email} (id ${row.id}).` : `${email} already exists.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
