ALTER TABLE "admins" DROP CONSTRAINT "admins_role_check";--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_role_faculty_check";--> statement-breakpoint
ALTER TABLE "admins" DROP CONSTRAINT "admins_faculty_id_faculties_id_fk";
--> statement-breakpoint
ALTER TABLE "holidays" ADD COLUMN "note" text;--> statement-breakpoint
-- Hand-edited: add updated_by as nullable, backfill from created_by, then enforce NOT NULL,
-- so the migration also works when holidays already has rows.
ALTER TABLE "holidays" ADD COLUMN "updated_by" integer;--> statement-breakpoint
UPDATE "holidays" SET "updated_by" = "created_by";--> statement-breakpoint
ALTER TABLE "holidays" ALTER COLUMN "updated_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_updated_by_admins_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admins" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "admins" DROP COLUMN "faculty_id";--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_note_length" CHECK ("holidays"."note" IS NULL OR char_length("holidays"."note") <= 500);
