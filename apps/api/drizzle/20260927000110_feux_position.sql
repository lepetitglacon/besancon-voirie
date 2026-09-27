-- NB : SRID 4326 et reprise de geom_osm ajoutés à la main, drizzle-kit 0.31 ignore l'option srid des colonnes geometry.
ALTER TABLE "feu" ADD COLUMN "geom_osm" geometry(Point, 4326);--> statement-breakpoint
ALTER TABLE "feu" ADD COLUMN "position_manuelle" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "feu" SET "geom_osm" = "geom" WHERE "osm_id" IS NOT NULL;
