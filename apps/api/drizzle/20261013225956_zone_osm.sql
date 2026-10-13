CREATE TABLE "zone_osm" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"geom" geometry(MultiPolygon, 4326) NOT NULL,
	"source" jsonb NOT NULL,
	"modifiee_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zone_osm_unique" CHECK ("zone_osm"."id" = 1)
);
