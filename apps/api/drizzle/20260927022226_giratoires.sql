CREATE TYPE "public"."priorite_entree" AS ENUM('cedez_le_passage', 'stop', 'priorite_a_droite');--> statement-breakpoint
ALTER TYPE "public"."nature_carrefour" ADD VALUE 'giratoire' BEFORE 'traversee_pietonne';--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "priorite_entree" "priorite_entree";--> statement-breakpoint
ALTER TABLE "carrefour" ADD COLUMN "anneau" jsonb;--> statement-breakpoint
ALTER TABLE "ligne_feux" ADD COLUMN "anneau" text;