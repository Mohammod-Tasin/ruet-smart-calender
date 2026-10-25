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
- **Admin:** every admin is equal. Any admin can create/edit/delete/restore
  any holiday for any audience, including `ALL`. There are NO roles and NO
  faculty scoping. Admins are created only via the `db:create-admin` script.
- Safety comes from transparency, not restrictions: every holiday shows who
  created/last edited it and when, every change is in `audit_log`, deletes are
  soft and restorable, and overlapping holidays trigger a warning (Section 5).

## 2. Domain model

```
University
 └── Faculty        (e.g. ECE = Electrical & Computer)
      └── Department (CSE, EEE, ECE, ETE ...)
           └── Series (identified by intake year: CSE-23 = CSE intake 2023)
```

- **Series is the smallest unit.** Sections (A/B/C) are NOT modelled.
- A series is identified by `intake_year` and never renamed. "23 series"
  stays 23 forever. Only `is_active` changes.
- Dates are NOT stored. The month grid (6 weeks x 7 days = 42 cells, week
  starts Saturday) is computed on the frontend. Only holidays are stored.

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
│   │   ├── calendar/    # month grid, audience compression, overlap (unit tested)
│   │   ├── auth/        # token, origin, rate-limit, cookie, client IP (unit tested)
│   │   └── validation/  # zod schemas shared by API and UI
│   ├── server/          # server-only code (import 'server-only')
│   │   ├── db/          # Drizzle schema, client, queries
│   │   ├── auth/        # password hashing, sessions, login attempts
│   │   ├── services/    # holiday create/update/delete/restore (transaction + audit)
│   │   └── http/        # JSON error helpers, guardMutation, requireAdmin
│   ├── components/      # MonthGrid, DayCell, HolidayChip, AudiencePicker ...
│   └── lib/             # client-side api helpers, shared types
├── drizzle/             # generated SQL migrations (committed)
├── scripts/             # seed.ts, create-admin, setup-app-role, test-auth, test-holidays
├── tests/               # vitest
└── .github/workflows/   # ci.yml, backup.yml
```

Layering rule: `app/api/**/route.ts` stays thin — parse → validate (zod) →
`requireAdmin` (for admin routes) → service (server) → JSON response.
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
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now())
  -- Phases 2-4 created role + faculty_id; Phase 5 drops them via a new migration.

holidays(
  id BIGSERIAL PK, title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  note TEXT NULL CHECK (note IS NULL OR char_length(note) <= 500),   -- "why"; shown in details/overlap warning
  start_date DATE NOT NULL, end_date DATE NOT NULL CHECK (end_date >= start_date),
  created_by INT NOT NULL REFERENCES admins,
  updated_by INT NOT NULL REFERENCES admins,                          -- = created_by on insert
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
- Weekly off days (Thu, Fri) are a config value, not rows. The working week is
  Saturday to Wednesday (5 days) and the month grid starts on Saturday.

## 5. Authorization and overlap warnings

Authorization: any logged-in, active admin may do any holiday write. The only
check is `requireAdmin`. Do not build a permission/role system.

Overlap detection (`src/core/calendar/overlap.ts` — pure, must have unit tests):

- Two holidays overlap when BOTH are true:
  1. Dates intersect: `a.start <= b.end AND b.start <= a.end`.
  2. Audiences intersect: expand each audience to the set of ACTIVE series ids
     (`ALL` → every active series; `FACULTY:x` → active series of its
     departments; `DEPARTMENT:d` → its active series; `SERIES:s` → itself)
     and the two sets share at least one id.
- Return, per conflicting holiday: id, title, note, startDate, endDate, label,
  createdBy {id, name}, createdAt, updatedBy {id, name}, updatedAt, the
  overlapping date range, and the shared audience as a compressed label
  (e.g. `EEE-23`).
- On update, exclude the holiday being edited from the comparison.

Server enforcement:

- `POST` and `PATCH` run the overlap check. If any conflicts exist and the body
  does not include `"confirmOverlap": true`, respond `409 OVERLAP` with
  `{ error: {...}, conflicts: [...] }` and save nothing.
- With `"confirmOverlap": true` the write proceeds; the audit_log `after`
  JSON records `confirmedOverlapWith: [ids]`.
- The admin UI (Phase 7) shows the conflicts with three choices:
  edit the existing holiday / save anyway (resend with confirmOverlap) / cancel.

## 6. Audience compression (src/core/calendar — must have unit tests)

Given a holiday's audience and the current set of active series, produce a
display label, collapsing bottom-up:

1. All active series of a department present → show department code (`CSE`).
2. All departments of a faculty present → show faculty label (`ECE Faculty`).
3. All departments present → `ALL`.
   Order: faculty sort_order, then department code, then intake year descending.
   Series format: `CSE-23` (department code + last two digits of intake year).
   Separator in UI: `·`.

## 7. API (v1)

Public:

- `GET /api/holidays?from=YYYY-MM-DD&to=YYYY-MM-DD[&series=ID]`
  - returns holidays overlapping the range:
    `start_date <= to AND end_date >= from AND deleted_at IS NULL`
  - each item: id, title, note, startDate, endDate, audience (raw),
    label (compressed), updatedBy {name}, updatedAt
  - max range 400 days; validate both dates; 400 on bad input
  - header: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
- `GET /api/structure` — faculties, departments, active series (for filters/pickers)
- `GET /api/health`

Auth:

- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
  (`/me` returns id, name, email — no role)

Admin (require session; never cached: `Cache-Control: no-store`):

- `POST /api/admin/holidays` — body: title, note?, startDate, endDate,
  audience[], confirmOverlap? → 201 | 409 OVERLAP
- `PATCH /api/admin/holidays/[id]` — same fields, partial; same 409 rule
- `DELETE /api/admin/holidays/[id]` (soft)
- `POST /api/admin/holidays/[id]/restore` — undo a soft delete
- `POST /api/admin/holidays/check-overlap` — same body as POST, returns
  `{ conflicts: [...] }` without saving (lets the UI warn while the admin is
  still filling the form)
- `GET /api/admin/holidays/[id]` — full details incl. createdBy/updatedBy names
- `GET /api/admin/holidays/deleted` — soft-deleted holidays, newest first (for "Recently deleted")
- `GET /api/admin/audit?holidayId=` — change history (any admin)
- Admin accounts, departments and series are managed by scripts only (no API).

Errors: JSON `{ "error": { "code": "OVERLAP", "message": "..." } }` with
correct HTTP status (400/401/403/404/409/413/415/422/429/500). Never leak SQL
or stack traces to clients; log them server-side.

## 8. Security requirements (non-negotiable)

- Secrets only in env vars. `.env*` in `.gitignore` (except `.env.example`).
- Server-only modules start with `import 'server-only'` so they can never be
  bundled into client code. Never prefix secrets with `NEXT_PUBLIC_`.
- Passwords: argon2id. Minimum length 10.
- No public signup. Admins are created by `npm run db:create-admin`
  with the password typed interactively (never stored in a file).
  The same script can deactivate an admin (`--deactivate <email>`).
- Session: 32 random bytes (crypto), base64url, in cookie `rc_session`:
  `HttpOnly; Secure (in production); SameSite=Lax; Path=/; Max-Age=604800`.
  Store only sha256(token) in DB. Logout deletes the row. Expired rows ignored.
- Login rate limits via `login_attempts` table (serverless: no in-memory state):
  5 failures per email+IP in 15 min → 429; 20 failures per email from any IP
  in 15 min → 429. Same generic error for wrong email and wrong password.
  Client IP: `x-vercel-forwarded-for`, then `x-real-ip`, then first entry of
  `x-forwarded-for`, else `unknown`.
- State-changing requests must have `Content-Type: application/json` and an
  `Origin` header matching `APP_ORIGIN` (CSRF defence).
- Validate all input with zod (dates, title length, note length, ids exist,
  audience non-empty, no duplicate audience entries). Reject bodies over 64 KB.
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
WEEKLY_OFF_DAYS=THU,FRI
HIJRI_BD_DAY_OFFSET=1  # added to the Saudi (umalqura) Hijri date; Bangladesh sights the moon ~1 day later
```

## 10. Working rules for Claude Code

- Work in the phases below, one phase per session/PR. Do not jump ahead.
- Before writing code in a phase, show a short plan and wait for approval.
- After each phase run `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`; fix all failures before stopping.
- Write table-driven tests for `core/calendar` (compression and overlap)
  and `core/auth`.
- Keep route handlers thin (see layering rule).
- Explain what you did at the end of each phase in simple terms; the
  developer is learning, so mention _why_ for non-obvious choices.
- Commit with clear messages. Never commit secrets.

## 11. Phases

1. ✅ Scaffold Next.js app, folder structure, strict TS, lint/format, vitest,
   `.env.example`, `/api/health`, CI workflow.
2. ✅ Drizzle schema + migrations (owner, direct URL derived automatically) +
   `db:setup-role` script + seed (faculties, departments, series) +
   create-admin script.
3. ✅ Public API: `/api/structure`, `/api/holidays` + compression (with tests).
4. ✅ Auth: login/logout/me, sessions, rate limits, origin check, session guard.
5. ✅ Drop admin roles (migration), add `note` + `updated_by`, admin holiday
   CRUD + restore + overlap detection/409 + check-overlap endpoint + audit log
   (with tests).
6. ✅ Public month view UI (grid, filters, mobile, dark mode).
7. ✅ Admin UI: login, range select across months, audience picker, note field,
   live overlap warning with "edit existing / save anyway / cancel",
   edit/delete/restore, "set by X on date" on every holiday.
8. ✅ Deploy to Vercel, env vars, nightly backup workflow (pg_dump artifact).
9. Yearly holidays: §0 corrections, categories/colours + `classes_only`,
   `holiday_rules` + overrides + versioning + Hijri + MANUAL_YEARLY, one
   `getOffDays()`, seed of the RUET 2026 list, "Yearly holidays" admin page with
   "dates needed" panel, spanning-bar calendar with lane algorithm.
10. Semester engine (§15): pure core + tables + APIs + audit + impact diff.
11. Semester UI: Status page, timeline drawer, calendar header line, admin
    semester screens, impact preview in holiday forms, reminders.

Full reference for 9–11: `docs/phase-9-11-spec.md`.

## 13. Holiday categories, rules and sources (Phase 9)

- `holidays` and `holiday_rules` have `classes_only` (RUET "শুধুমাত্র ক্লাস বন্ধ"):
  counts as an off day everywhere; the day sheet shows a "শুধু ক্লাস বন্ধ" badge.
  `holidays.category` (default `HOLIDAY`, red). Category → colour lives in one map
  (`src/lib/categories.ts`); adding a category is a one-line change.
- Every consumer (public calendar, admin calendar, overlap check, semester engine)
  reads holidays through ONE function: `getOffDays(range, audienceFilter?)`, which
  merges (1) one-off `holidays`, (2) `holiday_rules` expanded on the fly (nothing
  pre-generated), (3) `holiday_rule_overrides`. Occurrence ids for rules are
  `rule:<ruleId>:<year>`. Occurrence: title, category, classesOnly, startDate,
  endDate, audience, label, source (`ONE_OFF` | `RULE`), tentative, ruleId?, year?.
- `holiday_rules`: kind `GREGORIAN_FIXED {month,day,lengthDays}`; `HIJRI
  {startHijri,endHijri}` (each `{month,day,offsetDays}`) or `{type:'LAST_WEEKDAY',
  hijriMonth, weekday}`; `MANUAL_YEARLY {defaultLengthDays}`. Hijri uses
  `Intl` `islamic-umalqura` (no library) + `HIJRI_BD_DAY_OFFSET`; Hijri
  occurrences are **tentative** until an override with `confirmed=true` exists.
  MANUAL_YEARLY shows nothing for a year without an override; the admin page lists
  those under "তারিখ দিতে হবে / Dates needed".
- Rule versioning: edit "from year Y" = old rule `effective_to_year = Y-1` + new
  rule `effective_from_year = Y` (in place if Y ≤ old from-year; overrides for
  years ≥ Y move to the new rule). End "from year Y" = `effective_to_year = Y-1`
  (soft-delete only if Y ≤ from-year). Past years never change. All audited
  (`audit_log.entity_type` = `RULE` / `RULE_OVERRIDE`, `holiday_id` nullable).
- `holiday_rule_overrides` (one year): move dates, skip, or confirm. Admin
  one-click for HIJRI: −1 day, +1 day, Confirm.
- Calendar shows multi-day holidays as spanning bars split at week rows, lanes from
  the pure `src/core/calendar/lanes.ts`; max lanes desktop 3, mobile 2, then
  "+N more". Day cells contain ONLY holidays.

## 14. Seed: RUET 2026 yearly holidays

`db:seed` also seeds the verified RUET 2026 list (all audience `ALL`) as rules
(only when `holiday_rules` is empty): fixed-date days as GREGORIAN_FIXED, Islamic
days as HIJRI with confirmed 2026 overrides, Hindu/Buddhist/summer days as
MANUAL_YEARLY with 2026 overrides. Titles are Bengali; every Hindu puja is just
"সনাতনী ছুটি". Full table: `docs/phase-9-11-spec.md` §7.

## 15. Department semester state (Phases 10–11, not built yet)

Each **series** has its own semester; the timeline is derived, never stored.
Default template: CLASS 7 wk (extends), MID_BREAK 1 (no extend), CLASS 6 wk
(extends), VIVA 1 (extends), FINALS 4 (extends). A week where all 5 working days
(Sat–Wed) are off for that series is skipped and shifts the rest; partial weeks,
holidays split across two weeks, and full weeks in MID_BREAK never shift (admin can
force). Manual corrections: checkpoints, week overrides (FORCE_EXTEND / NO_EXTEND),
template override, pins. Pure engine in `src/core/semester/timeline.ts`; state is
shown on a Status page and timeline drawer, **never inside calendar day cells**.
Details and API list: `docs/phase-9-11-spec.md` §4.

## 12. Seed data

Undergraduate degree-awarding departments (14):

- Faculty of Electrical & Computer Engineering (ECE): EEE, CSE, ECE, ETE
  (faculty codes ECE, CE, ME may equal a department code; labels add " Faculty" to tell them apart)
- Faculty of Civil Engineering (CE): CE, ARCH, URP, BECM
- Faculty of Mechanical Engineering (ME): ME, IPE, CME, MTE, MSE, ChE

Active undergraduate series: 2021, 2022, 2023, 2024, and 2025. Seed
each active series for every undergraduate degree-awarding department.
