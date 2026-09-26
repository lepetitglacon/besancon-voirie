-- NB : SRID 4326 ajouté à la main, drizzle-kit 0.31 ignore l'option srid des colonnes geometry.
CREATE TYPE "public"."statut_carrefour" AS ENUM('a_confirmer', 'non_releve', 'estime', 'mesure', 'verifie');--> statement-breakpoint
CREATE TYPE "public"."statut_moderation" AS ENUM('en_attente', 'valide', 'rejete');--> statement-breakpoint
CREATE TABLE "branche" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"code" text NOT NULL,
	"nom" text,
	"osm_way_id" bigint,
	"azimut_deg" real,
	CONSTRAINT "branche_carrefour_id_code_unique" UNIQUE("carrefour_id","code")
);
--> statement-breakpoint
CREATE TABLE "carrefour" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nom" text NOT NULL,
	"geom" geometry(Point, 4326) NOT NULL,
	"statut" "statut_carrefour" DEFAULT 'non_releve' NOT NULL,
	"controleur" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"osm_nodes" bigint[] DEFAULT '{}' NOT NULL,
	"pres_tram" boolean DEFAULT false NOT NULL,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL,
	"modifie_le" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carrefour_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ligne_feux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"code" text NOT NULL,
	"signal" text NOT NULL,
	"branche_code" text,
	"mouvements" text[] DEFAULT '{}' NOT NULL,
	"voies" smallint,
	"traverse" text,
	"geom" geometry(Point, 4326),
	CONSTRAINT "ligne_feux_carrefour_id_code_unique" UNIQUE("carrefour_id","code")
);
--> statement-breakpoint
CREATE TABLE "plan_feux" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"code" text NOT NULL,
	"mode" text DEFAULT 'cycle' NOT NULL,
	"plages" jsonb NOT NULL,
	"cycle_s" real,
	"jaune_s" real,
	"reference" jsonb,
	"lignes" jsonb,
	"source_releve" uuid,
	CONSTRAINT "plan_feux_carrefour_id_code_unique" UNIQUE("carrefour_id","code")
);
--> statement-breakpoint
CREATE TABLE "releve" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"pseudo" text,
	"brut" jsonb NOT NULL,
	"synthese" jsonb NOT NULL,
	"cycles_observes" smallint NOT NULL,
	"ecart_type_cycle_s" real,
	"observe_le" timestamp with time zone NOT NULL,
	"statut" "statut_moderation" DEFAULT 'en_attente' NOT NULL,
	"motif_rejet" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branche" ADD CONSTRAINT "branche_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ligne_feux" ADD CONSTRAINT "ligne_feux_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_feux" ADD CONSTRAINT "plan_feux_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_feux" ADD CONSTRAINT "plan_feux_source_releve_releve_id_fk" FOREIGN KEY ("source_releve") REFERENCES "public"."releve"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releve" ADD CONSTRAINT "releve_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carrefour_geom_idx" ON "carrefour" USING gist ("geom");--> statement-breakpoint
CREATE INDEX "releve_statut_idx" ON "releve" USING btree ("statut","cree_le");