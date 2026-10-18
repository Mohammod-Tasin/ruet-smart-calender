# RUET Holiday Calendar — Project Brief for Claude Code

Read this file fully before doing any work. It is the source of truth for
architecture and rules. If a request conflicts with this file, ask first.

## 1. What we are building

A Google-Calendar-style **month view of university holidays** for RUET.
Looking at one month should show, on each day, **which departments / series
are off**. Example cell labels:

- `ALL` — whole university is off (e.g. Eid)
- `CSE · EEE` — every active series of CSE and EEE is off
- `CSE-23 · ME-22 · EEE-21` — only those specific series are off

Scope for v1: **holidays only**. No exams, class tests, or other event types.

Users:

- **Public (students/teachers):** view only, no login.
- **SUPER_ADMIN:** can create/edit/delete any holiday for anyone.
- **FACULTY_ADMIN:** can manage holidays only for departments/series inside
  their own faculty.

## 2. Domain model

```
University
 └── Faculty        (e.g. EC = Electrical & Computer)
      └── Department (CSE, EEE, ECE, ETE ...)
           └── Series (identified by intake year: CSE-23 = CSE intake 2023)
```

- **Series is the smallest unit.** Sections (A/B/C) are NOT modelled.
- A series is identified by `intake_year` and never renamed. "23 series"
  stays 23 forever. Only `is_active` changes.
- Dates are NOT stored. The month grid (6 weeks x 7 days = 42 cells, week
  starts Sunday) is computed on the frontend. Only holidays are stored.

## 3. Architecture

**One Next.js app** (frontend + backend), one repo, one Vercel project (Hobby).

```
ruet-calendar/
├── CLAUDE.md
├── src/
│   ├── app/
│   │   ├── page.tsx                     # public month view
│   │   ├── admin/login/page.tsx         # admin login
│   │   ├── admin/page.tsx               # admin panel
│   │   └── api/                         # backend: Route Handlers (route.ts)
│   │       ├── health/route.ts
│   │       ├── structure/route.ts
│   │       ├── holidays/route.ts
│   │       ├── auth/{login,logout,me}/route.ts
│   │       └── admin/...
│   ├── core/            # PURE business logic, no Next.js / DB imports
│   │   ├── calendar/    # month grid, audience compression (unit tested)
│   │   ├── permission/  # authorization rules (unit tested)
│   │   └── validation/  # zod schemas shared by API and UI
│   ├── server/          # server-only code (import 'server-only')
│   │   ├── db/          # Drizzle schema, client, queries
│   │   ├── auth/        # password hashing, sessions, rate limit
│   │   ├── services/    # holiday create/update/delete (transaction + audit)
│   │   └── http/        # JSON error helpers, origin check, session guard
│   ├── components/      # MonthGrid, DayCell, HolidayChip, AudiencePicker ...
│   └── lib/             # client-side api helpers, shared types
├── drizzle/             # generated SQL migrations (committed)
├── scripts/             # seed.ts, create-super-admin.ts
├── tests/               # vitest
└── .github/workflows/   # ci.yml, backup.yml
```

Layering rule: `app/api/**/route.ts` stays thin — parse → validate (zod) →
auth/permission (core) → service (server) → JSON response.
`core/` must never import from `server/`, `app/`, or Next.js, so it can be
reused later (e.g. by a mobile app backend or another service).

### Stack

- Next.js (App Router) + TypeScript (strict) + Tailwind CSS.
- Route Handlers run on the **Node.js runtime** (`export const runtime = 'nodejs'`).
- Neon Postgres via `@neondatabase/serverless` **Pool** with
  `drizzle-orm/neon-serverless` (supports interactive transactions).
- Drizzle ORM + drizzle-kit for migrations. No raw string-concatenated SQL.
- `zod` for validation. `@node-rs/argon2` (argon2id) for passwords.
- `vitest` for unit tests.
- Month grid built by our own helper (`buildMonthGrid`), not a calendar library.
- Mobile-first UI (must look good at 360px), dark mode supported.

### Database

- Neon Postgres (free plan), region Singapore. Single branch for now.
- Two roles, minimal manual work:
  - `DATABASE_URL_OWNER` — Neon default owner (`neondb_owner`), pooled string
    copied from the Neon Console. Used ONLY locally / in GitHub Actions for
    migrations, seeding and backups. **Never set on Vercel.**
  - `DATABASE_URL` — `app_user` (least privilege), pooled. The ONLY DB var the
    running app and Vercel ever see.
- `drizzle.config.ts` and scripts derive the direct (non-pooled) owner URL by
  removing `-pooler` from the host; the developer only pastes pooled strings.
- `npm run db:setup-role` (scripts/setup-app-role.ts, run with the owner URL):
  1. generates a strong random password,
  2. creates `app_user` if missing (or resets its password if it exists),
  3. grants CONNECT, USAGE on schema public, SELECT/INSERT/UPDATE/DELETE on all
     tables, USAGE/SELECT on all sequences, plus matching
     `ALTER DEFAULT PRIVILEGES` for future tables,
  4. revokes UPDATE, DELETE on `audit_log` from `app_user` (append-only audit),
  5. prints the ready-to-paste pooled `DATABASE_URL` for `app_user`.
     It must be idempotent (safe to run again) and must re-apply step 4 after
     every migration (`db:migrate` calls it automatically or reapplies the revoke).

## 4. Schema (v1)

```sql
faculties(
  id SERIAL PK, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0)

departments(
  id SERIAL PK, faculty_id INT NOT NULL REFERENCES faculties,
  code TEXT UNIQUE NOT NULL, name TEXT NOT NULL)

series(
  id SERIAL PK, department_id INT NOT NULL REFERENCES departments,
  intake_year INT NOT NULL CHECK (intake_year BETWEEN 2000 AND 2100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(department_id, intake_year))

admins(
  id SERIAL PK, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL (store lowercased),
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','FACULTY_ADMIN')),
  faculty_id INT NULL REFERENCES faculties,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'SUPER_ADMIN' AND faculty_id IS NULL)
      OR (role = 'FACULTY_ADMIN' AND faculty_id IS NOT NULL)))

holidays(
  id BIGSERIAL PK, title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  start_date DATE NOT NULL, end_date DATE NOT NULL CHECK (end_date >= start_date),
  created_by INT NOT NULL REFERENCES admins,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL)
  -- index on (start_date, end_date) WHERE deleted_at IS NULL

holiday_audience(
  holiday_id BIGINT NOT NULL REFERENCES holidays ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ALL','FACULTY','DEPARTMENT','SERIES')),
  scope_id INT NULL,
  CHECK ((scope_type = 'ALL') = (scope_id IS NULL)),
  UNIQUE NULLS NOT DISTINCT (holiday_id, scope_type, scope_id))

sessions(
  token_hash TEXT PK,             -- sha256 hex of the random token; raw token only in cookie
  admin_id INT NOT NULL REFERENCES admins ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL)

login_attempts(
  id BIGSERIAL PK, email TEXT NOT NULL, ip TEXT NOT NULL,
  success BOOLEAN NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())

audit_log(
  id BIGSERIAL PK, admin_id INT NOT NULL REFERENCES admins,
  action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE','RESTORE')),
  holiday_id BIGINT NOT NULL REFERENCES holidays,
  before JSONB NULL, after JSONB NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now())
```

Rules:

- Dates are `DATE`, transported as `"YYYY-MM-DD"` strings end to end
  (Drizzle `date(..., { mode: 'string' })`). Never pass holiday dates through
  JS `Date` + time zones on the server. Business time zone is Asia/Dhaka.
- Deletes are soft (`deleted_at`). Every write also writes `audit_log`
  in the **same transaction**.
- Weekly off days (Fri, Sat) are a config value, not rows.

## 5. Authorization rules (src/core/permission — must have unit tests)

- SUPER_ADMIN: allowed everything.
- FACULTY_ADMIN with faculty F may create/update/delete a holiday only if
  **every** audience entry is inside F:
  - `ALL` → forbidden
  - `FACULTY:x` → allowed only if x == F
  - `DEPARTMENT:d` → allowed only if d.faculty_id == F
  - `SERIES:s` → allowed only if s's department.faculty_id == F
- For update/delete, both the existing audience AND the new audience must pass.
- Checks happen on the server for every write. Frontend hiding is UX only.

## 6. Audience compression (src/core/calendar — must have unit tests)

Given a holiday's audience and the current set of active series, produce a
display label, collapsing bottom-up:

1. All active series of a department present → show department code (`CSE`).
2. All departments of a faculty present → show faculty label (`EC Faculty`).
3. All departments present → `ALL`.
   Order: faculty sort_order, then department code, then intake year descending.
   Series format: `CSE-23` (department code + last two digits of intake year).
   Separator in UI: `·`.

## 7. API (v1)

Public:

- `GET /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD[&series=ID]`
  - returns holidays overlapping the range:
    `start_date <= to AND end_date >= from AND deleted_at IS NULL`
  - each item: id, title, startDate, endDate, audience (raw), label (compressed)
  - max range 400 days; validate both dates; 400 on bad input
  - header: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- `GET /api/structure` — faculties, departments, active series (for filters/pickers)
- `GET /api/health`

Admin (require session; never cached: `Cache-Control: no-store`):

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `POST /api/admin/holidays`
- `PATCH /api/admin/holidays/[id]`
- `DELETE /api/admin/holidays/[id]` (soft)
- `GET /api/admin/audit?holidayId=` (SUPER_ADMIN all; FACULTY_ADMIN own faculty)
- SUPER_ADMIN only: CRUD for admins, departments, series.

Errors: JSON `{ "error": { "code": "FORBIDDEN", "message": "..." } }` with
correct HTTP status (400/401/403/404/409/422/429/500). Never leak SQL or
stack traces to clients; log them server-side.

## 8. Security requirements (non-negotiable)

- Secrets only in env vars. `.env*` in `.gitignore` (except `.env.example`).
- Server-only modules start with `import 'server-only'` so they can never be
  bundled into client code. Never prefix secrets with `NEXT_PUBLIC_`.
- Passwords: argon2id. Minimum length 10.
- No public signup. First SUPER_ADMIN is created by `scripts/create-super-admin.ts`
  with the password typed interactively (never stored in a file).
- Session: 32 random bytes (crypto), base64url, in cookie `rc_session`:
  `HttpOnly; Secure (in production); SameSite=Lax; Path=/; Max-Age=604800`.
  Store only sha256(token) in DB. Logout deletes the row. Expired rows ignored.
- Login rate limit via `login_attempts` table (serverless: no in-memory state):
  5 failures per email+IP in 15 min → 429. Same generic error for wrong email
  and wrong password.
- State-changing requests must have `Content-Type: application/json` and an
  `Origin` header matching `APP_ORIGIN` (CSRF defence).
- Validate all input with zod (dates, title length, ids exist, audience
  non-empty, no duplicate audience entries). Reject bodies over 64 KB.
- Security headers via `next.config.ts`: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- All queries through Drizzle (parameterised). No `sql.raw` with user input.
- The running app uses only the least-privilege `app_user`; owner credentials
  never reach Vercel. `audit_log` is append-only for `app_user`.

## 9. Environment variables

`.env.local` (and Vercel project settings):

```
DATABASE_URL_OWNER=  # neondb_owner pooled string from Neon Console. Local/CI only, NOT on Vercel
DATABASE_URL=        # app_user pooled string, printed by `npm run db:setup-role`
APP_ORIGIN=          # http://localhost:3000 locally, https://<app>.vercel.app in prod
WEEKLY_OFF_DAYS=FRI,SAT
```

## 10. Working rules for Claude Code

- Work in the phases below, one phase per session/PR. Do not jump ahead.
- Before writing code in a phase, show a short plan and wait for approval.
- After each phase run `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`; fix all failures before stopping.
- Write table-driven tests for `core/permission` and `core/calendar`.
- Keep route handlers thin (see layering rule).
- Explain what you did at the end of each phase in simple terms; the
  developer is learning, so mention _why_ for non-obvious choices.
- Commit with clear messages. Never commit secrets.

## 11. Phases

1. Scaffold Next.js app, folder structure, strict TS, lint/format, vitest,
   `.env.example`, `/api/health`, CI workflow.
2. Drizzle schema + migrations (owner, direct URL derived automatically) +
   `db:setup-role` script + seed (faculties, departments, series) +
   create-super-admin script.
3. Public API: `/api/structure`, `/api/holidays` + compression (with tests).
4. Auth: login/logout/me, sessions, rate limit, origin check, session guard.
5. Admin holiday CRUD with permission checks (with tests) + audit log.
6. Public month view UI (grid, chips, "+N more", filters, mobile, dark mode).
7. Admin UI: login, range select across months, audience picker, edit/delete.
8. Deploy to Vercel, env vars, nightly backup workflow (pg_dump artifact).

## 12. Seed data (fill in before Phase 2)

Undergraduate degree-awarding departments (14):

- Faculty of Electrical & Computer Engineering (ECE): EEE, CSE, ECE, ETE
- Faculty of Civil Engineering (CE): CE, ARCH, URP, BECM
- Faculty of Mechanical Engineering (ME): ME, IPE, CME, MTE, MSE, ChE


Active undergraduate series: 2021, 2022, 2023, 2024, and 2025. Seed
each active series for every undergraduate degree-awarding department.
