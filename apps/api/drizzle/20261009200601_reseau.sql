CREATE TYPE "public"."source_reseau" AS ENUM('osm', 'manuel');--> statement-breakpoint
CREATE TABLE "noeud" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"osm_node_id" bigint,
	"carrefour_id" uuid,
	"geom" geometry(Point, 4326) NOT NULL,
	"liaisons" jsonb,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noeud_osm_node_id_unique" UNIQUE("osm_node_id")
);
--> statement-breakpoint
CREATE TABLE "troncon" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"noeud_de" uuid NOT NULL,
	"noeud_vers" uuid NOT NULL,
	"geom" geometry(LineString, 4326) NOT NULL,
	"osm_way_id" bigint,
	"osm_de" bigint,
	"osm_vers" bigint,
	"nom" text,
	"highway" text,
	"voies_avant" smallint DEFAULT 1 NOT NULL,
	"voies_arriere" smallint DEFAULT 1 NOT NULL,
	"vitesse_kmh" smallint,
	"source" "source_reseau" NOT NULL,
	"modifie" boolean DEFAULT false NOT NULL,
	"supprime" boolean DEFAULT false NOT NULL,
	"branche_de" text,
	"branche_vers" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "troncon_voies_check" CHECK ("troncon"."voies_avant" BETWEEN 0 AND 9 AND "troncon"."voies_arriere" BETWEEN 0 AND 9 AND "troncon"."voies_avant" + "troncon"."voies_arriere" > 0),
	CONSTRAINT "troncon_noeuds_check" CHECK ("troncon"."noeud_de" <> "troncon"."noeud_vers")
);
--> statement-breakpoint
ALTER TABLE "noeud" ADD CONSTRAINT "noeud_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troncon" ADD CONSTRAINT "troncon_noeud_de_noeud_id_fk" FOREIGN KEY ("noeud_de") REFERENCES "public"."noeud"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "troncon" ADD CONSTRAINT "troncon_noeud_vers_noeud_id_fk" FOREIGN KEY ("noeud_vers") REFERENCES "public"."noeud"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "noeud_geom_idx" ON "noeud" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "noeud_carrefour_idx" ON "noeud" USING btree ("carrefour_id");--> statement-breakpoint
CREATE INDEX "troncon_geom_idx" ON "troncon" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "troncon_noeud_de_idx" ON "troncon" USING btree ("noeud_de");--> statement-breakpoint
CREATE INDEX "troncon_noeud_vers_idx" ON "troncon" USING btree ("noeud_vers");--> statement-breakpoint
CREATE INDEX "troncon_osm_way_idx" ON "troncon" USING btree ("osm_way_id");