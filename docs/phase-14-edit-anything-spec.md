# Phase 14 Spec: Edit any holiday from the calendar + client feedback

Client feedback from Asad (31 Oct 2026) plus "edit any holiday by tapping
it". Read with CLAUDE.md, phase-12 and phase-13 specs. Ask before any DB
write or migration (CLAUDE.md §10). All copy in simple English.

## 1. Faculty names, not codes

Public and admin UI show the full faculty name ("Electrical & Computer
Engineering"), never "FECE/FCE/FME". Codes stay internal (DB, API).

## 2. Changeable mid-term break (default stays after class week 7)

The default does NOT change: mid-term break after class week 7. Admins can
change it for one series' one semester when needed (e.g. CME-21 had it
after week 8), and the system reminds them 2 weeks before it is due.

### 2.1 Reminder in the admin to-do list

- New task `MID_BREAK_CHECK`: for every series whose mid-term break is
  expected to start within the next 14 days (Asia/Dhaka today) and that
  semester's break is not yet confirmed.
- Group by (batch, semester, expected start date), like the semester-start
  task. Card:
  "Batch 2023 · Semester 3-1: mid-term break expected from Sat 14 Nov
   (after class week 7). Is that right?"
  Departments: CSE, EEE, …
  Buttons: **Yes, that's right** · **Change** ("Some departments are
  different" link for per-department answers).
- "Yes" stores a confirmation (no schedule change); the card disappears.
- "Change" opens the schedule fields (§2.2) pre-filled, with a live line
  "Mid-term break will start Sat 21 Nov (after class week 8)."
- The card also disappears once the break has started. Ignoring it is safe:
  the default keeps running.
- Tests: card appears exactly 14 days before, not for already-confirmed or
  changed semesters, grouping, disappears after the break starts.

### 2.2 Per-semester schedule

- New table `series_semester_schedule(series_id, semester_no,
  structure JSONB NULL, mid_break_confirmed BOOLEAN DEFAULT false, note,
  created_by, created_at, updated_at, UNIQUE(series_id, semester_no))`.
  `structure` NULL = use the default. Overrides academic_settings for that
  one semester only; the next semester uses the default again.
- Editable fields: classes before mid-term break, classes after, Board Viva
  weeks, Semester Final weeks. Show the class total ("total 13").
  Validate: each ≥ 0, class total 1-20, Final 1-8.
- Engine: `computeJourney` takes the structure per (series, semester_no).
  "Class week N of M" and "Final N of M" use that semester's numbers.
- UI: in "Where is X now?" a link "This semester has a different schedule"
  → the four fields, pre-filled. Bulk: same from a column header / whole
  department. Change history lists it.
- No data is written by the migration; admins set exceptions from the UI.
- Tests: an 8 + 5 example (mid-term break after week 8; class week 9 is the
  first after the break), override does not leak into next semester,
  "Class 7 of 13" labels use the override.

## 3. Week strip shows dates

In "Show full plan", each box shows the Saturday's day number of that week
(month labels stay above). Tap/hover a box: "Sat 3 Oct – Wed 7 Oct · Class
week 2" (or "Holiday week: Sanatani Holiday"). Keep 360px friendly.

## 4. Weekends next to a holiday (fixes Asad's "it went back")

Data stays as the official dates (auto-trim stays on the server).
Display changes:
- **Calendar bars extend across adjacent weekly-off days** (Thu/Fri) that
  directly touch the holiday, so 17-21 Oct renders as one continuous bar
  15-23 Oct. The weekend part uses the same colour at reduced opacity.
  Only extend into Thu/Fri directly adjacent; never past them.
- Day sheet: "Sanatani Holiday · 17–21 Oct · With the weekend, students are
  off 15–23 Oct."
- Holiday form, before saving, live line: "Students will be off 15–23 Oct
  (Thursday and Friday are weekly holidays)." If the admin typed 15–23,
  show: "We'll save 17–21 Oct. The calendar still shows 15–23 as off." —
  so nothing feels silently undone.
- Pure helper `extendWithAdjacentOffDays(range, weeklyOff)` with tests.

## 5. Edit any holiday by tapping it (admin calendar)

Tapping any bar opens one sheet. Content depends on the source.

**One-off holiday / class suspension:** Edit (title, note, dates, who),
Delete, History. (Exists; ensure the bar tap opens it directly.)

**Yearly rule occurrence** (e.g. Victory Day 16 Dec 2026):
```
Victory Day · Wed 16 Dec 2026 · Repeats every year
[ Change date ]  [ No holiday this year ]  More ▾ (Edit name/who, Stop repeating, History)
```
"Change date" → From/To, then "Apply this change to":
  - **Only {year}** → override for that year.
  - **{year} and every year after** → rule versioning (new rule version
    from that year). For fixed-date rules: new month/day/length. For Hijri
    rules: shift the rule offsets by the same number of days. For manual
    yearly rules this option is hidden (they have no yearly pattern).
Defaults: "Only {year}".

**Time rules (Asia/Dhaka "today"):**
1. If the NEW dates for this year are before today → "Only {year}" and
   "{year} and every year after" are disabled; the only option is
   "Every year from {year+1}". Message: "13 Dec 2026 has already passed, so
   this change starts from 2027. This year's holiday stays on 16 Dec."
2. If the ORIGINAL occurrence is already over (end < today) and the admin
   edits this year → allowed only through a separate "Fix a past holiday"
   confirm step: "This holiday is in the past. Changing it recalculates
   the semester history of N series." Default flow never rewrites the past.
3. A change that starts in the past and ends in the future is allowed only
   for the future part; explain in one line.
Server enforces 1-3 (reject with 422 + clear message), not just the UI.

**Every edit:** one-line semester impact before saving; audited; an
"Undo" toast for 10 seconds after saving (reverts through the services,
audited as a normal change).

## 6. Tests

Time rules 1-3 with fixed "today" values (incl. the 15 Dec → 13 Dec
example), versioning for fixed and Hijri rules ("every year after"), only-
this-year override, past-edit rejection on the server, adjacent-weekend
extension, per-semester schedule. Lint, typecheck, tests, build.
