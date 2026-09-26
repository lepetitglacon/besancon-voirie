ALTER TABLE "plan_feux" ADD COLUMN "etapes" jsonb;--> statement-breakpoint
ALTER TABLE "plan_feux" ADD COLUMN "degagements" jsonb DEFAULT '{}'::jsonb NOT NULL;