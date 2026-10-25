# RUET Holiday Calendar

A Google-Calendar-style month view of RUET university holidays. Each day shows which
departments or series are off (`ALL`, `CSE · EEE`, `CSE-23 · ME-22`). Students and teachers
just view it; admins sign in to add, edit, delete and restore holidays. Holidays only (v1).

Next.js (App Router) + TypeScript + Tailwind, Neon Postgres via Drizzle, deployed on Vercel.
The full design and rules live in [CLAUDE.md](CLAUDE.md).

## Local setup

Requires Node 22+ and a [Neon](https://neon.tech) project (Singapore region).

```bash
npm ci
cp .env.example .env.local      # then fill it in (below)
npm run db:migrate              # create tables (uses the owner URL)
npm run db:seed                 # faculties, departments, series 2021-2025
npm run db:setup-role           # creates app_user, PRINTS the DATABASE_URL to paste in .env.local
npm run db:create-admin         # asks for name, email, password (min 10 chars)
npm run dev                     # http://localhost:3000
```

`.env.local`:

| Variable              | Value                                                                            |
| --------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL_OWNER`  | Pooled connection string of `neondb_owner` from the Neon Console. Local/CI only. |
| `DATABASE_URL`        | The `app_user` pooled string printed by `db:setup-role`.                         |
| `APP_ORIGIN`          | `http://localhost:3000` locally; the production URL on Vercel.                   |
| `WEEKLY_OFF_DAYS`     | `THU,FRI` (working week is Saturday to Wednesday)                                |
| `HIJRI_BD_DAY_OFFSET` | `1` (days added to the Saudi Hijri date for Bangladesh moon sighting)            |

Run `db:setup-role` once after the first migrate (it is safe to repeat; it resets the
`app_user` password, so re-paste the new `DATABASE_URL` everywhere if you run it again).

## Scripts

| Command                               | What it does                                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev` / `build` / `start`     | Next.js dev server / production build / run the build            |
| `npm run lint` / `typecheck` / `test` | ESLint / TypeScript / Vitest (CI runs all three + build)         |
| `npm run format`                      | Prettier                                                         |
| `npm run db:generate`                 | Generate a SQL migration after editing the Drizzle schema        |
| `npm run db:migrate`                  | Apply migrations, then re-apply the append-only audit_log revoke |
| `npm run db:setup-role`               | Create/reset `app_user` and its grants                           |
| `npm run db:seed`                     | Seed faculties, departments, active series, 2026 yearly holidays |
| `npm run db:create-admin`             | Create an admin (`-- --deactivate <email>` to deactivate)        |
| `npm run test:auth` / `test:holidays` | End-to-end checks against a running dev server + database        |

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel (Hobby, framework auto-detected as Next.js).
2. Set **only** these environment variables (Production): `DATABASE_URL` (the `app_user`
   string), `APP_ORIGIN` (the final `https://…vercel.app` URL, no trailing slash),
   `WEEKLY_OFF_DAYS` (`THU,FRI`), `HIJRI_BD_DAY_OFFSET` (`1`). **Never** add `DATABASE_URL_OWNER` to Vercel.
3. Run migrations/seed/admin creation from your own machine (they use the owner URL).
4. After changing env vars, redeploy: Vercel only applies them to new deployments.

Schema changes: `npm run db:generate`, commit the new SQL in `drizzle/`, then run
`npm run db:migrate` locally against the production database **before** deploying code that needs it.

## Backup and restore

`.github/workflows/backup.yml` runs `pg_dump` every night at 03:00 Asia/Dhaka (21:00 UTC)
and can be started manually from **Actions → Backup → Run workflow**. Each run uploads a
`.dump` artifact kept for 30 days. It needs the repository secret `DATABASE_URL_OWNER`.

Restore (into an empty Neon database, with `pg_restore` v18 installed):

```bash
# 1. download the artifact from the Actions run and unzip it
# 2. use the DIRECT owner URL (pooled string with "-pooler" removed from the host)
pg_restore --no-owner --no-acl --clean --if-exists -d "$DIRECT_OWNER_URL" ruet-calendar-YYYY-MM-DD.dump
# 3. re-create app_user and its grants (prints a new DATABASE_URL, update Vercel and redeploy)
npm run db:setup-role
```

Notes: GitHub pauses scheduled workflows after 60 days without repo activity (re-enable in
the Actions tab). The dump contains admin password hashes and session hashes, so treat the
artifact as sensitive and keep the repository private.
