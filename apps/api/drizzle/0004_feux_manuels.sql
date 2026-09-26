-- NB : SRID 4326 ajouté à la main, drizzle-kit 0.31 ignore l'option srid des colonnes geometry.
CREATE TYPE "public"."nature_carrefour" AS ENUM('carrefour', 'traversee_pietonne');--> statement-breakpoint
CREATE TYPE "public"."type_feu" AS ENUM('vehicule', 'pieton');--> statement-breakpoint
CREATE TABLE "feu" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_id" bigint,
	"type" "type_feu" NOT NULL,
	"tags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL,
	"present_osm" boolean DEFAULT true NOT NULL,
	"carrefour_id" uuid,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feu_osm_id_unique" UNIQUE("osm_id")
);
--> statement-breakpoint
ALTER TABLE "carrefour" ADD COLUMN "nature" "nature_carrefour" DEFAULT 'carrefour' NOT NULL;--> statement-breakpoint
ALTER TABLE "feu" ADD CONSTRAINT "feu_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feu_geom_idx" ON "feu" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "feu_carrefour_idx" ON "feu" USING btree ("carrefour_id");