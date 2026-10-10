CREATE TYPE "public"."statut_essai_ia" AS ENUM('terminee', 'echec', 'delai');--> statement-breakpoint
CREATE TABLE "essai_ia" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analyse_id" uuid,
	"carrefour_id" uuid NOT NULL,
	"modele" text NOT NULL,
	"modele_reel" text,
	"effort" text NOT NULL,
	"statut" "statut_essai_ia" NOT NULL,
	"duree_s" real NOT NULL,
	"cout_usd" real,
	"tokens_entree" integer,
	"tokens_sortie" integer,
	"resultat" jsonb,
	"erreur" text,
	"dossier" text,
	"cree_le" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "essai_ia" ADD CONSTRAINT "essai_ia_analyse_id_analyse_ia_id_fk" FOREIGN KEY ("analyse_id") REFERENCES "public"."analyse_ia"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "essai_ia" ADD CONSTRAINT "essai_ia_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "essai_ia_analyse_idx" ON "essai_ia" USING btree ("analyse_id");--> statement-breakpoint
CREATE INDEX "essai_ia_carrefour_idx" ON "essai_ia" USING btree ("carrefour_id","cree_le");