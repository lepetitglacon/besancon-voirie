CREATE TYPE "public"."statut_analyse_ia" AS ENUM('en_attente', 'en_cours', 'terminee', 'echec');--> statement-breakpoint
CREATE TABLE "analyse_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"statut" "statut_analyse_ia" DEFAULT 'en_attente' NOT NULL,
	"resultat" jsonb,
	"erreur" text,
	"demandee_le" timestamp with time zone DEFAULT now() NOT NULL,
	"commencee_le" timestamp with time zone,
	"finie_le" timestamp with time zone,
	"consultee_le" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "analyse_ia" ADD CONSTRAINT "analyse_ia_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyse_ia_statut_idx" ON "analyse_ia" USING btree ("statut","demandee_le");--> statement-breakpoint
CREATE INDEX "analyse_ia_carrefour_idx" ON "analyse_ia" USING btree ("carrefour_id");