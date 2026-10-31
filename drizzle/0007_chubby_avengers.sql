CREATE TABLE "series_semester_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"semester_no" integer NOT NULL,
	"structure" jsonb,
	"mid_break_confirmed" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_semester_schedule_one_per_semester" UNIQUE("series_id","semester_no"),
	CONSTRAINT "series_semester_schedule_semester_no_check" CHECK ("series_semester_schedule"."semester_no" BETWEEN 1 AND 8)
);
--> statement-breakpoint
ALTER TABLE "series_semester_schedule" ADD CONSTRAINT "series_semester_schedule_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_semester_schedule" ADD CONSTRAINT "series_semester_schedule_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;