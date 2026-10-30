# Phase 13 Spec: Simple English UI (public + admin)

Based on a live walkthrough of ruet-smart-calender.vercel.app on 30 Oct 2026.
Goal: a student understands their status in 5 seconds; an admin can finish
any task without reading instructions. Read with CLAUDE.md and
docs/phase-12-journey-spec.md. Engine and APIs stay; this is UI, copy and a
few data/logic fixes. Ask before changing engine behaviour.

## 0. Bugs found live (fix first)

1. **Weekend padding is still possible.** The 2026 override of the October
   "Sanatani Holiday" rule was set to 15-23 Oct (Thu-Fri) by an admin on
   27 Oct; the official dates are 17-21 Oct. Fix:
   - In every date form (one-off holiday, yearly override, bulk year form),
     **auto-trim** leading/trailing weekly off days on save and show a
     confirmation line: "Thursday and Friday are weekly holidays, so we saved
     17–21 Oct." (no extra click). Server enforces the same trim.
   - Data fix: set that 2026 override to 17-21 Oct through the service layer
     (audited). Show me the before/after; ask before writing.
2. **Wrong task for running batches.** Admin home shows "2021 Series · Set
   start date · 1-1 first class day" for batches that are mid-programme.
   Rule: the "first class day of 1-1" task appears ONLY for the newest intake
   year (current year, or previous year if its 1-1 has not started). Every
   other series without data gets the task "Set current status" which opens
   the Series Board with those cells highlighted. Never show a date field
   that would reset a running batch to 1-1.
3. **Delay reasons list the future.** CSE-23 shows 7 merged lines up to 2028.
   New rule (see §3.3).

## 1. Language and words (whole app)

- All UI text in **simple English**. English digits. Dates as "21 Nov" or
  "21 Nov 2026" (year only when not the current year). Weekday names short.
- Holiday titles in English too. There is a SINGLE `title` column (no `title_en`);
  existing rows were rewritten in place and admin forms ask for one English title.
  Seed English titles:
  Shab-e-Meraj, Saraswati Puja → **Sanatani Holiday**, Shab-e-Barat,
  Ramadan Vacation, Eid-ul-Fitr, Shab-e-Qadr, Jumatul Bida, Language Martyrs'
  Day, Independence Day, Bangla New Year, May Day, Buddha Purnima, Summer
  Vacation, Eid-ul-Adha, Hijri New Year, Ashura, July Uprising Day, Akheri
  Chahar Shomba, Eid-e-Miladunnabi, University Day, Fateha-e-Yazdaham,
  Martyred Intellectuals Day, Victory Day, Winter Vacation, Christmas.
  All Hindu puja days are titled **Sanatani Holiday** (no puja name).
- Fixed vocabulary (use exactly these everywhere):

  | Concept | Text |
  |---|---|
  | CLASS | Class week 5 of 13 (short: "Class 5/13") |
  | MID_BREAK | Mid-term break |
  | VIVA | Board Viva |
  | EXAM | Semester Final · week 2 of 4 (short: "Final 2/4") |
  | SEMESTER_BREAK | Semester break |
  | SUSPENDED_WEEK | Class Suspension (bar label "Classes suspended") |
  | classes_only | "Classes off · offices open" |
  | tentative | "Expected" (never "~" alone, never "estimated") |
  | series | "CSE-23" |
  | semester | "Semester 2-2" |

## 2. Public: Calendar tab

- Header: "RUET Holiday Calendar". Tabs: **Calendar · Semester Status**.
- First visit: a small card "Pick your series to see your holidays and
  semester status" with two selects (Department, Batch 21-25) and a Save
  button. After that a one-line strip shows (§3.1) with "Change".
- "Only my series" toggle stays (default on when a series is picked).
- Legend line under the grid in plain words: "Grey days: Thursday & Friday.
  Striped bars: date depends on moon sighting. Tap a day for details."
- Day sheet: title, date range, who it applies to ("Everyone" instead of
  "ALL"), badge for classes-off-only, "Expected date" for tentative. Remove
  "Set by …" from the public view (keep it in admin).
- Bar labels: "Everyone · Sanatani Holiday" instead of "ALL · …".

## 3. Public: Semester Status tab

### 3.1 My series card (top, when a series is picked)

```
CSE-23 · Semester 2-2
Semester Final · week 2 of 4
Ends around 11 Nov · Next: 3-1 classes start around 21 Nov
```
One tap opens the series sheet.

### 3.2 Board (all series)

- Title: "All departments today" + date picker "Show another date".
- Summary chips: "Class 14 · Mid-term break 6 · Board Viva 1 · Final 19".
- Matrix as now (rows = departments grouped by faculty, columns = 21-25),
  cell text short vocabulary + small "2-2". Empty cell: "No data".
- Fits 360px with sticky first column.

### 3.3 Series sheet (tap a cell) — keep it short

```
CSE-23
Semester 2-2 · Semester Final · week 2 of 4

This semester
  ✓ Classes        27 Jun – 26 Sep
  ✓ Mid-term break 15 Aug
  ✓ Board Viva     3 Oct
  ● Semester Final 10 Oct – 11 Nov   ← now
    Semester break 14 Nov
Next
    Semester 3-1 starts around 21 Nov

Delayed so far this semester: 1 week
  • Sanatani Holiday (17–21 Oct)
```
- **Delay list rule:** only skipped weeks inside the CURRENT semester with
  weekStart ≤ selected date. One line per holiday (if one week was skipped
  because of several holidays, name the one that covers most of the week).
  No future years, no merged "A ও B ও C" titles.
- Dates the admin has not confirmed show "around".
- "Show full plan" link (collapsed by default) reveals the remaining
  semesters (3-1 … 4-2) with expected start dates. The week strip moves
  inside this collapsed area.

## 4. Admin

### 4.1 Home = to-do list only

Each card: one sentence, one action, department names listed.

- "Semester 2-2 has ended for Batch 24. When did 2-2 classes start?"
  Departments: CSE, ECE, EEE, ETE, ARCH, BECM, CE, URP, CME, ChE, IPE…
  Date field pre-filled with the expected date, button **Confirm**.
  Link "Some departments started on a different day" → per-department dates.
- "4 series have no status yet: BECM-21, CME-21, MSE-21, URP-23" →
  **Set status** (opens Series Board with those cells highlighted).
- "New batch 2026: when did 1-1 classes start?" (only per §0.2).
- "Add 2027 holiday dates (5 holidays)" from 1 Nov → opens §4.3 form.
- "Eid-ul-Fitr is expected on 9 Mar. Moon sighted?" (within 30 days).
- Empty state: "All done. Nothing needs your attention."

### 4.2 Series Board

- Same matrix as public. Tap a cell → sheet:
  "Where is CSE-23 now?" → three steps shown one at a time, pre-filled with
  the current status: Semester (1-1…4-2) → Stage (Class / Mid-term break /
  Board Viva / Semester Final / Semester break) → Week (only for Class and
  Final). A live sentence before Save: "From today, CSE-23 is in Semester
  2-2, Semester Final week 2." Button **Save**.
- Column header tap = whole batch, with "Except: [department chips]".
- Rename "সংরক্ষিত তথ্য" to "Change history" (collapsed), entries in plain
  English, delete only there.

### 4.3 Calendar + Yearly holidays

- Calendar day sheet: two buttons **Add holiday** / **Suspend classes this
  week**. Form: Title, Note (optional), From, To, Who is off (Everyone /
  Department / Series), "Classes off only" checkbox. Overlap and semester
  impact each one plain line, e.g. "EEE-23 Final will move 1 week later."
- Yearly holidays page, split into three sections:
  1. **Needs your action** — rules missing dates for the selected year, and
     moon-sighting holidays in the next 60 days. Moon row: "Eid-ul-Fitr
     expected 9 Mar" + buttons **Same day · 1 day later · 1 day earlier**.
     Manual row: **Set dates**.
  2. **Automatic every year** (collapsed): fixed-date holidays, read-only.
  3. **Moon-based** (collapsed): the rest of the Hijri rules.
  Per row, only the main action is visible; Skip / Reset / Edit rule / End
  rule go under a "More" menu.
- Bulk "Add 2027 dates" form: one row per manual holiday with From/To,
  auto-trim (§0.1), impact line, **Save all**.

## 5. Acceptance (I will check on a phone)

- A first-time student finds their series' status in ≤ 2 taps.
- No Bengali or Bengali digits anywhere in the UI (holiday titles included).
- "Board Viva" used everywhere for VIVA.
- CSE-23 sheet shows exactly one delay line (Sanatani Holiday) on 30 Oct.
- Admin home shows no "1-1 first class day" task for batches 21-25.
- Entering 15–23 Oct saves as 17–21 Oct with the message.
- Yearly page row shows at most 2 visible buttons.
- Update tests for: delay rule (current semester, ≤ date, one line per
  holiday), task rules, auto-trim, vocabulary helpers. Lint, typecheck,
  tests, build. Ask before any DB write or migration (CLAUDE.md §10).
