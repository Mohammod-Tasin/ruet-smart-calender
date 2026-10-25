# Phase 9–11 Spec: Yearly Holidays, Ramadan/Eid, Calendar Bars, Department Semester State

Read this together with CLAUDE.md. The durable rules are merged into CLAUDE.md
(§13–§15 and the Phases list). This file is the full reference.

---

## 0. Corrections to existing rules (apply first)

- **Weekly off days are THURSDAY and FRIDAY.** `WEEKLY_OFF_DAYS=THU,FRI`
  everywhere.
- **Working week = Saturday → Wednesday (5 working days).**
- **Month grid starts on Saturday** (columns: Sat Sun Mon Tue Wed Thu Fri),
  matching RUET's official printed calendar. Still 6 x 7 = 42 cells.
- Thu/Fri columns are shaded as weekly off days.

## 1. Holiday categories and colours

- `classes_only BOOLEAN DEFAULT false` on holidays and rules. RUET marks some
  days "শুধুমাত্র ক্লাস বন্ধ থাকবে". They count as off days exactly like other
  holidays; the day sheet shows a small badge "শুধু ক্লাস বন্ধ".
- `category` on holidays (default `HOLIDAY`, red). Build a category → colour map
  so adding one is a one-line change.
- Tentative occurrences render with the same colour but dashed/striped and the
  word "সম্ভাব্য / Tentative" in details.

## 2. Holiday sources

Every consumer (public calendar, admin calendar, overlap check, semester
engine) reads holidays through ONE function:

    getOffDays(range, audienceFilter?) → occurrences[]

merging: (1) one-off `holidays`; (2) recurring `holiday_rules`, expanded on the
fly (nothing pre-generated); (3) per-year `holiday_rule_overrides`.

Occurrence ids for rules: `rule:<ruleId>:<year>`. Occurrences carry: title,
category, startDate, endDate, audience, label, source (`ONE_OFF` | `RULE`),
tentative, ruleId?, year?.

### 2.1 `holiday_rules`

    id, title, category, audience (rows in holiday_rule_audience), kind,
    params jsonb, effective_from_year NOT NULL, effective_to_year NULL,
    classes_only, created_by, updated_by, created_at, updated_at, deleted_at

`kind`:

- `GREGORIAN_FIXED` — `{ month, day, lengthDays }`. Automatic every year.
- `HIJRI` — `{ startHijri: {month, day, offsetDays}, endHijri: {month, day,
offsetDays} }`, converted with `Intl.DateTimeFormat` / `islamic-umalqura`
  (no library). Global `HIJRI_BD_DAY_OFFSET` (default +1) is added. Tentative
  until an admin confirms that year (override `confirmed=true`).
  Also `{ type: 'LAST_WEEKDAY', hijriMonth, weekday }` for "last <weekday> of a
  Hijri month" (Jumatul Bida, Akheri Chahar Shomba).
- `MANUAL_YEARLY` — `{ defaultLengthDays }`. Each year's dates come from an
  override. No override → nothing shown that year; admin dashboard lists it
  under "তারিখ দিতে হবে / Dates needed for <year>".

### 2.2 Versioning (past years never change)

- Edit "from year Y onward": old rule `effective_to_year = Y-1`, insert new rule
  with `effective_from_year = Y`. If Y equals old from-year, update in place.
- Delete "from year Y onward": `effective_to_year = Y-1` (soft-delete only if
  Y ≤ effective_from_year).
- All audited.

### 2.3 `holiday_rule_overrides` (one year only)

    rule_id, year, start_date NULL, end_date NULL, skipped BOOL DEFAULT false,
    confirmed BOOL DEFAULT false, note, updated_by, updated_at,
    UNIQUE(rule_id, year)

Admin one-click for HIJRI: "−1 day", "+1 day", "Confirm".

### 2.4 Admin page "বাৎসরিক ছুটি / Yearly holidays"

Rules table (title, kind, summary, audience, active years); year selector with
computed dates, tentative badges, override actions; "Dates needed" panel;
add / edit (asks "from which year?") / end rule.

### 2.5 Seed — see §7.

## 3. Calendar rendering: spanning bars

- Multi-day holiday = one continuous bar, split at week-row boundaries
  (continuation shown with arrow/flat edge).
- Lanes per week row: sort by start, longer first; lowest lane free for all its
  days in that row.
- Bar text: compressed label + title, ellipsis; full details in day sheet.
- Max visible lanes per row (desktop 3, mobile 2) then "+N more".
- Mobile: thin coloured bars without text acceptable.
- Pure lane algorithm in `src/core/calendar/lanes.ts` with tests.
- Day cells contain ONLY holidays.

## 4. Department semester state (Phases 10–11)

Default template: CLASS 7 wk (extends), MID_BREAK 1 (no extend), CLASS 6 wk
(extends), VIVA 1 (extends), FINALS 4 (extends). Each series has its own
semester. A full holiday week for a series = all 5 working days (Sat–Wed) off
for that series from any source; that week is not counted and the schedule
shifts. Partial weeks, split holidays and full weeks in MID_BREAK never shift
(admin can force). Timeline is derived, never stored
(`src/core/semester/timeline.ts`). Manual corrections: checkpoints, week
overrides (FORCE_EXTEND / NO_EXTEND), template override, pins. Tables:
semesters, semester_checkpoints, semester_week_overrides, semester_pins;
audit_log gets entity_type + entity_id. Bulk start/checkpoint, impact preview
(`POST /api/admin/impact`), public Status page, timeline drawer, APIs as in the
original brief.

## 5. Tests (non-negotiable)

Hijri conversion + BD offset + tentative/confirm; rule versioning;
MANUAL_YEARLY missing-date detection; lane assignment; timeline cases; impact
diff. Worked example: start Sat 3 Oct 2026, no holidays → class wk1 = 3 Oct,
mid break = 21 Nov, class wk8 = 28 Nov, wk13 = 2 Jan, viva = 9 Jan, finals
start 16 Jan. Whole-university holiday Sat 17 Oct – Wed 21 Oct → mid break
28 Nov, finals 23 Jan.

## 6. Phases

- **Phase 9** — §0 corrections, categories/colours, holiday_rules + overrides +
  versioning + Hijri + MANUAL_YEARLY, getOffDays merge, seed from §7, Yearly
  holidays admin page, spanning bars.
- **Phase 10** — semester engine (pure core + tables + APIs + audit + impact).
- **Phase 11** — Status page, timeline drawer, calendar header line, admin
  semester screens, impact preview in holiday forms, reminders.

## 7. RUET 2026 holiday list (seed source)

All audiences `ALL`. `*` = moon sighting. `**` = only classes closed.
Titles stored in Bengali exactly as below. Every Hindu puja holiday is titled
just **"সনাতনী ছুটি"**. Buddha Purnima keeps its name.

### A. GREGORIAN_FIXED (effective_from_year = 2026)

| Date            | Title                                 | Length | Flags        |
| --------------- | ------------------------------------- | ------ | ------------ |
| 21 Feb          | শহিদ দিবস ও আন্তর্জাতিক মাতৃভাষা দিবস | 1      |              |
| 26 Mar          | স্বাধীনতা ও জাতীয় দিবস               | 1      |              |
| 14 Apr          | বাংলা নববর্ষ                          | 1      |              |
| 1 May           | মে দিবস                               | 1      |              |
| 5 Aug           | জুলাই গণঅভ্যুত্থান দিবস               | 1      |              |
| 1 Sep           | বিশ্ববিদ্যালয় দিবস                   | 1      | classes_only |
| 14 Dec          | শহিদ বুদ্ধিজীবী দিবস                  | 1      |              |
| 16 Dec          | বিজয় দিবস                            | 1      |              |
| 19 Dec – 31 Dec | শীতকালীন ছুটি                         | 13     |              |
| 25 Dec          | বড়দিন                                | 1      |              |

### B. HIJRI (tentative until confirmed; 2026 overrides = dates below, confirmed=true)

Choose rule offsets so the 2026 computation (with `HIJRI_BD_DAY_OFFSET`)
reproduces these dates; if it differs by a day keep the rule and rely on the
confirmed 2026 override. Report the chosen offsets.

| 2026 dates      | Title                  | Hijri anchor                      | Flags           |
| --------------- | ---------------------- | --------------------------------- | --------------- |
| 17 Jan          | শব-ই-মিরাজ             | 27 Rajab                          | *               |
| 4 Feb           | শব-ই-বরাত              | 15 Sha'ban                        | *               |
| 19 Feb – 20 Mar | পবিত্র রমজানের অবকাশ   | 1 Ramadan → last day of Ramadan   | ** classes_only |
| 14 Mar – 25 Mar | ঈদ-উল-ফিতর             | around 1 Shawwal (≈ −7 … +4 days) |                 |
| 17 Mar          | শব-ই-কদর               | 27 Ramadan                        |                 |
| 20 Mar          | জুমাতুল বিদা           | last Friday of Ramadan            |                 |
| 26 May – 3 Jun  | ঈদ-উল-আযহা             | around 10 Dhul-Hijjah             |                 |
| 26 Jun          | মুহাররম (আশুরা)        | 10 Muharram                       | *               |
| 12 Aug          | আখেরী চাহার সোম্বা     | last Wednesday of Safar           | *               |
| 26 Aug          | ঈদ-ই-মিলাদুন্নবী (সাঃ) | 12 Rabi-ul-Awal                   | *               |
| 24 Sep          | ফাতেহা-ই-ইয়াজদাহম     | 11 Rabi-us-Sani                   | *               |

Ramadan vacation and Eid-ul-Fitr overlap (14–20 Mar); together one continuous
off period 19 Feb – 25 Mar. Keep them as separate rules.

### C. MANUAL_YEARLY (2026 overrides = dates below)

| 2026 dates      | Title                                  |
| --------------- | -------------------------------------- |
| 23 Jan          | সনাতনী ছুটি                            |
| 1 May           | বুদ্ধ পূর্ণিমা (বৈশাখী পূর্ণিমা) — `*` |
| 21 May – 25 May | গ্রীষ্মকালীন ছুটি                      |
| 4 Sep           | সনাতনী ছুটি                            |
| 17 Oct – 21 Oct | সনাতনী ছুটি                            |

### Sanity checks the semester engine must reproduce for 2026 (Sat–Wed weeks)

- Ramadan + Eid-ul-Fitr (19 Feb – 25 Mar) → 5 full weeks skipped (weeks
  starting 21 Feb, 28 Feb, 7 Mar, 14 Mar, 21 Mar).
- Summer + Eid-ul-Adha (21 May – 3 Jun) → 2 full weeks (23 May, 30 May).
- সনাতনী ছুটি 17–21 Oct → 1 full week (17 Oct).
- Winter (19–31 Dec) → 2 full weeks (19 Dec, 26 Dec).
- 14 Dec + 16 Dec alone → no skip.
