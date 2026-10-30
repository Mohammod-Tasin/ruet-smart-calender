# Phase 12 Spec: Series Journey (simplified semester model) + simpler UI

Read together with CLAUDE.md and docs/phase-9-11-spec.md. This spec REPLACES
the semester model of Phases 10-11 (semesters, checkpoints, pins, week
overrides, per-semester templates). Holidays, yearly rules, getOffDays(),
auth and audit stay as they are. Merge the durable rules into CLAUDE.md as
the first step. Ask before deviating.

## 0. Goals (non-negotiable)

- **Admin effort minimal.** An admin should only need to log in every 2-3
  months. They never enter a semester start date unless the system asks.
- **Two kinds of admin input only** for semesters:
  1. **Position** — "today this series is in semester S, phase P, week W".
  2. **Suspended week** — a whole Sat-Wed week with no classes for some
     audience.
  Plus holidays, which already exist.
- **Everything else is computed**, for the whole 4-year programme.
- **Students see a simple, glanceable view.** No internal jargon.

## 1. Programme and semester structure

- Every programme is 4 years = 8 semesters: 1-1, 1-2, 2-1, 2-2, 3-1, 3-2,
  4-1, 4-2 (semester_no 1..8). After 4-2 the series is GRADUATED.
- Every semester (including 1-1) has the same structure, stored ONCE in a
  settings row (editable by an admin, rarely):

  | Phase | Weeks | Extends on a full off week? |
  |---|---|---|
  | CLASS (weeks 1-7) | 7 | yes |
  | MID_BREAK | 1 | no |
  | CLASS (weeks 8-13) | 6 | yes |
  | VIVA (board viva) | 1 | yes |
  | EXAM | 4 | yes |
  | SEMESTER_BREAK | 1 | no |

  Then the next semester's CLASS week 1 starts the following Saturday.
- Working week = Sat-Wed. Weekly off = THU,FRI (env WEEKLY_OFF_DAYS).
- A **full off week** for a series = all 5 working days are off for that
  series from getOffDays() (one-off holidays, yearly rules incl. tentative
  Hijri, overrides, suspended weeks).
- In an extendable phase, a full off week is not counted; the whole rest of
  the journey moves one week later. Partial weeks never shift anything. A
  holiday split across two weeks never shifts anything by itself.
- Exam has no per-day dates; UI shows only "পরীক্ষা · nth সপ্তাহ".

## 2. Suspended week (replaces "অটো", FORCE_EXTEND)

- UI name: **"স্থগিত সপ্তাহ"** (English: Suspended week).
- Stored as a one-off holiday with `category = 'SUSPENDED_WEEK'`, always
  exactly Sat-Wed of one week, audience = ALL / faculty / department / series,
  title default "ক্লাস স্থগিত".
- It is shown on the public calendar (its own neutral colour, label
  "স্থগিত") and naturally makes that week a full off week, so the engine
  shifts the journey. Deleting it undoes the shift. No separate engine code.
- Admin creates it in one tap from the calendar: tap any day → "এই সপ্তাহ
  স্থগিত" → pick audience → save.

## 3. Data model

New:
```
series_positions(
  id BIGSERIAL PK, series_id INT NOT NULL REFERENCES series,
  as_of_date DATE NOT NULL,                -- normalised to that week's Saturday
  semester_no INT NOT NULL CHECK (semester_no BETWEEN 1 AND 8),
  phase TEXT NOT NULL CHECK (phase IN ('CLASS','MID_BREAK','VIVA','EXAM','SEMESTER_BREAK')),
  week_no INT NOT NULL,                    -- CLASS 1..13, EXAM 1..4, others 1
  kind TEXT NOT NULL CHECK (kind IN ('POSITION','SEMESTER_START')),
  note TEXT NULL,
  created_by INT NOT NULL REFERENCES admins, created_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  UNIQUE (series_id, as_of_date) WHERE deleted_at IS NULL)

academic_settings(id = 1, structure JSONB NOT NULL, updated_by, updated_at)
```
- SEMESTER_START = admin confirmed the exact first class day of a semester
  (phase CLASS, week 1). POSITION = "they are here now".
- All writes audited (entity_type 'SERIES_POSITION' / 'ACADEMIC_SETTINGS'),
  same transaction.

Removed (new migration): semesters, semester_checkpoints,
semester_week_overrides, semester_pins. Migration converts every existing
active checkpoint/start into a series_positions row (derive semester_no from
the semester label like "2-2"; if a label is missing, list those series in
the migration output for the admin to fix). Report what was converted.

Series activity: a series is active from its intake until it graduates.
New intake series rows (e.g. 2026) are created by the seed/admin script
for all departments; they show "শুরুর তারিখ দিন" until a position exists.

## 4. Journey engine (pure, src/core/journey/)

```
computeJourney({
  positions[],          // this series, sorted by as_of_date
  structure,            // from academic_settings
  isOffDay(date),       // this series, from getOffDays
  until?,               // stop date (default: graduation)
}) → {
  weeks[]: { weekStart, semesterNo, phase, weekNo, status COUNTED|SKIPPED,
             skipReasons[], confirmed: boolean },
  semesters[]: { semesterNo, label "২-২", classStart, midBreakStart,
                 vivaStart, examStart, breakStart, end, confirmed },
  graduation: date
}
stateOn(journey, date) → { semesterLabel, phase, weekNo, nextMilestone,
                           delayWeeks, delayReasons (grouped by title) }
```

Algorithm:
1. Take the earliest position as the anchor.
2. **Back-fill** the anchor's current semester: walk backwards from the
   anchor using the same skip rules to estimate earlier phase starts
   (e.g. "EXAM week 2 on 24 Oct" with 17-21 Oct fully off ⇒ exam started
   10 Oct). Mark back-filled starts `estimated`.
3. **Walk forward** week by week to graduation. At each week, if a later
   position exists for that week, jump to it (admin data always wins over
   computation).
4. A week is SKIPPED iff the current phase extends AND the week is a full
   off week. Skipped weeks don't consume the phase.
5. After SEMESTER_BREAK, start the next semester at CLASS week 1.
6. `confirmed` = everything from the latest SEMESTER_START (or the first
   POSITION) up to the end of that semester. Everything after is projected.

Required tests (table-driven, real 2026 seed rules where noted):
- CSE-23 example: POSITION 24 Oct 2026 = 2-2 EXAM week 2 ⇒ exam start 10 Oct
  (17 Oct week skipped), exam weeks 24 Oct, 31 Oct, 7 Nov, break 14 Nov,
  3-1 CLASS week 1 = 21 Nov, winter 19 Dec AND 26 Dec weeks both skipped.
- 14 + 16 Dec alone ⇒ no skip.
- Full off week in MID_BREAK and in SEMESTER_BREAK ⇒ no skip.
- Suspended week for EEE-23 only ⇒ EEE-23 shifts, CSE-23 doesn't.
- Later POSITION overrides computation.
- SEMESTER_START on a Tuesday ⇒ that week is CLASS week 1.
- Graduation after 4-2; 1-1 uses the same structure.
- Ramadan 2027 (tentative) shifts projected semesters.

## 5. Admin tasks ("করণীয়") — generated, never stored

`computeTasks(today)` returns, in this priority order:

1. **Next semester start date** — for every series whose current journey
   week is EXAM week ≥ 3, or later, and whose next semester has no
   SEMESTER_START yet. Group by (intake year, semester_no). Card:
   "২০২৩ সিরিজ · ১৪টি ডিপার্টমেন্ট · ৩-১ এর ক্লাস কবে শুরু?" with the
   projected date pre-filled, "সবার জন্য একই" (default) or "কয়েকটা আলাদা".
   Once the projected start has passed, the card turns red "বাকি".
   Submitting creates SEMESTER_START rows (one transaction) and the journey
   recomputes.
2. **New batch first class** — series with no position at all.
3. **Next year's dates needed** — from Nov 1, MANUAL_YEARLY rules with no
   override for next year (and for the current year if still missing).
4. **Confirm moon sighting** (optional, low priority) — tentative Hijri
   occurrences starting within 30 days.

If the admin ignores tasks, projections keep running; nothing breaks.

## 6. Admin UI (3 screens)

Top nav: **হোম · ক্যালেন্ডার · সিরিজ বোর্ড**. Yearly holidays move to a
"বছরের ছুটির তালিকা" button inside the calendar screen.

- **হোম**: task cards only (§5), plus "সব ঠিক আছে ✓" when empty.
- **ক্যালেন্ডার**: identical to the public calendar. Tap a day → bottom
  sheet with two buttons: "ছুটি দিন" and "এই সপ্তাহ স্থগিত". Audience
  picker: chips "সবাই" / "ডিপার্টমেন্ট ▾" / "সিরিজ ▾" (tree only on demand).
  Overlap warning and semester impact each as ONE line of text. Tap an
  existing bar → edit / delete / history.
- **বছরের ছুটির তালিকা**: fixed-date rules hidden by default ("প্রতি বছর
  একই — কিছু করতে হবে না" collapsed). Hijri rules: one row each with
  −১ / +১ / নিশ্চিত. Year-varying rules: one form "২০২৭ সালের তারিখ দিন"
  with one date-range field per rule.
- **সিরিজ বোর্ড**: the same matrix as the public status page (§7).
  Tap a cell → "এখন কোথায়?" sheet using only buttons: semester chips
  (১-১ … ৪-২), phase chips (ক্লাস / মিড ব্রেক / ভাইভা / পরীক্ষা / বিরতি),
  week chips. Tap a column header → same sheet for the whole intake (all
  departments), with per-department exceptions. This is also the go-live
  flow (5 column taps for 70 series).
- Remove the old /admin/semesters screens and the pin/override/checkpoint
  UI.

## 7. Public UI

- **"আমার সিরিজ"** picker (department + intake), stored in localStorage.
  When set, both tabs show at the top:
  "CSE-২৩ · ২-২ · পরীক্ষা চলছে (৩য় সপ্তাহ) · ৩-১ শুরু ~২১ নভেম্বর".
  `~` marks unconfirmed dates; no "আনুমানিক" banners.
- **ক্যালেন্ডার tab**: holidays + suspended weeks only. With "আমার সিরিজ"
  set, a toggle "শুধু আমার" (default on).
- **স্ট্যাটাস tab**: compact matrix, rows = departments grouped by faculty
  (faculty code FECE/FCE/FME), columns = intake ২১–২৫. Each cell: phase
  colour fill + 2-3 words ("ক্লাস ৯", "পরীক্ষা ৩/৪", "মিড ব্রেক", "—").
  Fits a 360px phone (sticky first column; horizontal scroll only inside the
  table). Date picker "অন্য দিনের অবস্থা". Summary line on top.
- Tap a cell → series sheet:
  ```
  CSE-২৩
  ✓ ১-১ ✓ ১-২ ✓ ২-১
  ● ২-২  পরীক্ষা চলছে · ৩য় সপ্তাহ
    ৩-১  শুরু ~২১ নভেম্বর
    ...
    ৪-২  শেষ ~…
  দেরির কারণ: শীতকালীন ছুটি +২ সপ্তাহ
  ```
  Expanding the current semester shows its phases with start dates and a
  week strip (month labels only, today marker).
- All digits Bengali everywhere (years, "২-২", date picker display text).

## 8. API changes

Public: `GET /api/status?date=` (matrix data), `GET /api/series/[id]/journey`.
Admin: `GET /api/admin/tasks`, `POST /api/admin/positions/bulk`
(POSITION or SEMESTER_START for many series), `DELETE /api/admin/positions/[id]`,
`GET/PUT /api/admin/academic-settings`, `POST /api/admin/impact` (unchanged
contract, now uses the journey engine). Remove the old semester routes.

## 9. Phases

- **12a** — migration + journey engine + tasks + APIs + tests (no UI).
  Verify against the 38 series already loaded: print a before/after table
  of current state per series.
- **12b** — admin UI (3 screens) and public UI (§6, §7).
- Update `scripts/test-semesters.ts` → `test-journey.ts` accordingly.
