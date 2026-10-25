CREATE TABLE "semester_checkpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"semester_id" integer NOT NULL,
	"as_of_date" date NOT NULL,
	"phase" text NOT NULL,
	"week_index" integer NOT NULL,
	"note" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semester_pins" (
	"semester_id" integer NOT NULL,
	"phase" text NOT NULL,
	"start_date" date NOT NULL,
	"note" text,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semester_pins_semester_id_phase_unique" UNIQUE("semester_id","phase")
);
--> statement-breakpoint
CREATE TABLE "semester_week_overrides" (
	"semester_id" integer NOT NULL,
	"week_start" date NOT NULL,
	"mode" text NOT NULL,
	"note" text,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semester_week_overrides_semester_id_week_start_unique" UNIQUE("semester_id","week_start"),
	CONSTRAINT "semester_week_overrides_mode_check" CHECK ("semester_week_overrides"."mode" IN ('FORCE_EXTEND','NO_EXTEND'))
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_id" integer NOT NULL,
	"label" text,
	"start_date" date NOT NULL,
	"template" jsonb NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "semesters_status_check" CHECK ("semesters"."status" IN ('ACTIVE','COMPLETED')),
	CONSTRAINT "semesters_label_length" CHECK ("semesters"."label" IS NULL OR char_length("semesters"."label") <= 30)
);
--> statement-breakpoint
ALTER TABLE "semester_checkpoints" ADD CONSTRAINT "semester_checkpoints_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_checkpoints" ADD CONSTRAINT "semester_checkpoints_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_pins" ADD CONSTRAINT "semester_pins_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_pins" ADD CONSTRAINT "semester_pins_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_week_overrides" ADD CONSTRAINT "semester_week_overrides_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester_week_overrides" ADD CONSTRAINT "semester_week_overrides_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_one_active_per_series" ON "semesters" USING btree ("series_id") WHERE "semesters"."status" = 'ACTIVE' AND "semesters"."deleted_at" IS NULL;