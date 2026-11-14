CREATE TABLE "batch_verifications" (
	"intake_year" integer PRIMARY KEY NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_by" integer
);
--> statement-breakpoint
ALTER TABLE "batch_verifications" ADD CONSTRAINT "batch_verifications_verified_by_admins_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;