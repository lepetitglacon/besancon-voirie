CREATE TYPE "public"."traversee_pieton" AS ENUM('feux', 'marquee', 'non_marquee');--> statement-breakpoint
ALTER TABLE "connexion" ADD COLUMN "trace" geometry(LineString, 4326);--> statement-breakpoint
ALTER TABLE "noeud" ADD COLUMN "feux" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "noeud" ADD COLUMN "pieton" "traversee_pieton";--> statement-breakpoint
ALTER TABLE "troncon" ADD COLUMN "types_avant" jsonb;--> statement-breakpoint
ALTER TABLE "troncon" ADD COLUMN "types_arriere" jsonb;--> statement-breakpoint
ALTER TABLE "troncon" ADD COLUMN "osm_tags" jsonb;