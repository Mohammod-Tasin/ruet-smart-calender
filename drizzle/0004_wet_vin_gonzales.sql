CREATE TABLE "academic_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"structure" jsonb NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_settings_single_row" CHECK ("academic_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "series_positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"semester_no" integer NOT NULL,
	"phase" text NOT NULL,
	"week_no" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "series_positions_semester_no_check" CHECK ("series_positions"."semester_no" BETWEEN 1 AND 8),
	CONSTRAINT "series_positions_week_no_check" CHECK ("series_positions"."week_no" BETWEEN 1 AND 30),
	CONSTRAINT "series_positions_phase_check" CHECK ("series_positions"."phase" IN ('CLASS','MID_BREAK','VIVA','EXAM','SEMESTER_BREAK')),
	CONSTRAINT "series_positions_kind_check" CHECK ("series_positions"."kind" IN ('POSITION','SEMESTER_START'))
);
--> statement-breakpoint
ALTER TABLE "academic_settings" ADD CONSTRAINT "academic_settings_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_positions" ADD CONSTRAINT "series_positions_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_positions" ADD CONSTRAINT "series_positions_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "series_positions_one_per_week" ON "series_positions" USING btree ("series_id","as_of_date") WHERE "series_positions"."deleted_at" IS NULL;
--> statement-breakpoint
-- Default semester structure (CLASS 7, MID_BREAK 1, CLASS 6, VIVA 1, EXAM 4, SEMESTER_BREAK 1).
INSERT INTO "academic_settings" ("id", "structure") VALUES (1, '[{"phase":"CLASS","weeks":7,"extendable":true},{"phase":"MID_BREAK","weeks":1,"extendable":false},{"phase":"CLASS","weeks":6,"extendable":true},{"phase":"VIVA","weeks":1,"extendable":true},{"phase":"EXAM","weeks":4,"extendable":true},{"phase":"SEMESTER_BREAK","weeks":1,"extendable":false}]'::jsonb);
--> statement-breakpoint
-- Convert the Phase 10-11 semesters (the old tables stay until 12b).
--  * ACTIVE semester with a label like "2-2" and a checkpoint -> POSITION(s). FINALS -> EXAM.
--    Its start_date is only the go-live anchor, so it is not converted.
--  * ACTIVE semester with a label and no checkpoint -> SEMESTER_START at start_date.
--  * No usable label -> not converted (listed by scripts/journey-report.ts).
-- as_of_date is moved to that week's Saturday (Saturday = 0 days back, Thursday = 5, ...).
INSERT INTO "series_positions" ("series_id","as_of_date","semester_no","phase","week_no","kind","note","created_by")
SELECT DISTINCT ON (s.series_id, wk)
  s.series_id,
  wk,
  ((substr(s.label,1,1)::int - 1) * 2 + substr(s.label,3,1)::int),
  CASE c.phase WHEN 'FINALS' THEN 'EXAM' ELSE c.phase END,
  c.week_index,
  'POSITION',
  c.note,
  c.created_by
FROM "semester_checkpoints" c
JOIN "semesters" s ON s.id = c.semester_id,
LATERAL (SELECT (c.as_of_date - ((extract(dow FROM c.as_of_date)::int + 1) % 7)) AS wk) w
WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL AND s.label ~ '^[1-4]-[12]$'
ORDER BY s.series_id, wk, c.as_of_date DESC, c.id DESC;
--> statement-breakpoint
INSERT INTO "series_positions" ("series_id","as_of_date","semester_no","phase","week_no","kind","created_by")
SELECT s.series_id,
  (s.start_date - ((extract(dow FROM s.start_date)::int + 1) % 7)),
  ((substr(s.label,1,1)::int - 1) * 2 + substr(s.label,3,1)::int),
  'CLASS', 1, 'SEMESTER_START', s.created_by
FROM "semesters" s
WHERE s.status = 'ACTIVE' AND s.deleted_at IS NULL AND s.label ~ '^[1-4]-[12]$'
  AND NOT EXISTS (SELECT 1 FROM "semester_checkpoints" c WHERE c.semester_id = s.id);
