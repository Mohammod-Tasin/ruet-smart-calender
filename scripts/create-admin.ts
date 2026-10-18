// Admin accounts are managed by this script only (there is no API for it).
//   npm run db:create-admin                              -> create an admin (prompts)
//   npm run db:create-admin -- --deactivate <email>      -> deactivate an admin
import { createInterface } from 'node:readline/promises';
import { hash } from '@node-rs/argon2'; // argon2id by default
import { eq } from 'drizzle-orm';
import { admins, sessions } from '../src/server/db/schema';
import { connectAsOwner } from './lib/owner-db';
import { askHidden } from './lib/prompt';

async function create() {
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
      .values({ name, email, passwordHash: await hash(password) })
      .onConflictDoNothing()
      .returning({ id: admins.id });
    console.log(row ? `Created admin ${email} (id ${row.id}).` : `${email} already exists.`);
  } finally {
    await pool.end();
  }
}

async function deactivate(rawEmail: string | undefined) {
  const email = rawEmail?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run db:create-admin -- --deactivate <email>');

  const { db, pool } = connectAsOwner();
  try {
    const [admin] = await db.select().from(admins).where(eq(admins.email, email));
    if (!admin) throw new Error(`No admin with email ${email}.`);
    if (!admin.isActive) return console.log(`${email} is already deactivated.`);

    // Never leave the system with nobody who can log in.
    if ((await db.$count(admins, eq(admins.isActive, true))) <= 1) {
      throw new Error('Refusing to deactivate the last active admin.');
    }

    await db.transaction(async (tx) => {
      await tx.update(admins).set({ isActive: false }).where(eq(admins.id, admin.id));
      await tx.delete(sessions).where(eq(sessions.adminId, admin.id)); // log them out now
    });
    console.log(`Deactivated ${email} and ended their sessions.`);
  } finally {
    await pool.end();
  }
}

async function main() {
  const i = process.argv.indexOf('--deactivate');
  if (i === -1) await create();
  else await deactivate(process.argv[i + 1]);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
