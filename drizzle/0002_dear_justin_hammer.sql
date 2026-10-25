CREATE TABLE "holiday_rule_audience" (
	"rule_id" integer NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" integer,
	CONSTRAINT "holiday_rule_audience_rule_id_scope_type_scope_id_unique" UNIQUE NULLS NOT DISTINCT("rule_id","scope_type","scope_id"),
	CONSTRAINT "holiday_rule_audience_scope_type_check" CHECK ("holiday_rule_audience"."scope_type" IN ('ALL','FACULTY','DEPARTMENT','SERIES')),
	CONSTRAINT "holiday_rule_audience_scope_id_check" CHECK (("holiday_rule_audience"."scope_type" = 'ALL') = ("holiday_rule_audience"."scope_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "holiday_rule_overrides" (
	"rule_id" integer NOT NULL,
	"year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"skipped" boolean DEFAULT false NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_by" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_rule_overrides_rule_id_year_unique" UNIQUE("rule_id","year"),
	CONSTRAINT "holiday_rule_overrides_dates_check" CHECK (("holiday_rule_overrides"."start_date" IS NULL) = ("holiday_rule_overrides"."end_date" IS NULL) AND ("holiday_rule_overrides"."start_date" IS NULL OR "holiday_rule_overrides"."end_date" >= "holiday_rule_overrides"."start_date"))
);
--> statement-breakpoint
CREATE TABLE "holiday_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'HOLIDAY' NOT NULL,
	"classes_only" boolean DEFAULT false NOT NULL,
	"kind" text NOT NULL,
	"params" jsonb NOT NULL,
	"effective_from_year" integer NOT NULL,
	"effective_to_year" integer,
	"created_by" integer NOT NULL,
	"updated_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "holiday_rules_title_length" CHECK (char_length("holiday_rules"."title") BETWEEN 1 AND 100),
	CONSTRAINT "holiday_rules_kind_check" CHECK ("holiday_rules"."kind" IN ('GREGORIAN_FIXED','HIJRI','MANUAL_YEARLY')),
	CONSTRAINT "holiday_rules_years_check" CHECK ("holiday_rules"."effective_to_year" IS NULL OR "holiday_rules"."effective_to_year" >= "holiday_rules"."effective_from_year")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "holiday_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entity_type" text DEFAULT 'HOLIDAY' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "entity_id" bigint;--> statement-breakpoint
UPDATE "audit_log" SET "entity_id" = "holiday_id";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "entity_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "category" text DEFAULT 'HOLIDAY' NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "classes_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "holiday_rule_audience" ADD CONSTRAINT "holiday_rule_audience_rule_id_holiday_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."holiday_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_rule_overrides" ADD CONSTRAINT "holiday_rule_overrides_rule_id_holiday_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."holiday_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_rule_overrides" ADD CONSTRAINT "holiday_rule_overrides_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_rules" ADD CONSTRAINT "holiday_rules_created_by_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_rules" ADD CONSTRAINT "holiday_rules_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;