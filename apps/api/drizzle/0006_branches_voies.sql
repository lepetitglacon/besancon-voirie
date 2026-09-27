CREATE TYPE "public"."sens_branche" AS ENUM('entrant', 'sortant', 'double');--> statement-breakpoint
CREATE TYPE "public"."type_voie" AS ENUM('generale', 'bus', 'velo', 'tram');--> statement-breakpoint
CREATE TABLE "voie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branche_id" uuid NOT NULL,
	"rang" smallint NOT NULL,
	"mouvements" text[] NOT NULL,
	"type" "type_voie" DEFAULT 'generale' NOT NULL,
	CONSTRAINT "voie_branche_id_rang_unique" UNIQUE("branche_id","rang")
);
--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "sens" "sens_branche" DEFAULT 'double' NOT NULL;--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "voies_sortantes" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "geom" geometry(LineString, 4326);--> statement-breakpoint
ALTER TABLE "voie" ADD CONSTRAINT "voie_branche_id_branche_id_fk" FOREIGN KEY ("branche_id") REFERENCES "public"."branche"("id") ON DELETE cascade ON UPDATE no action;