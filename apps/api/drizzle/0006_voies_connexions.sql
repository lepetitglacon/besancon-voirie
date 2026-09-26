-- Les voies de l'ancien modèle (flèches sans géométrie) ne peuvent pas être converties :
-- on les supprime avant d'ajouter les colonnes obligatoires sens et geom.
DELETE FROM "voie";--> statement-breakpoint
CREATE TYPE "public"."sens_voie" AS ENUM('entrante', 'sortante');--> statement-breakpoint
CREATE TABLE "connexion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"voie_entree_id" uuid NOT NULL,
	"voie_sortie_id" uuid NOT NULL,
	CONSTRAINT "connexion_voie_entree_id_voie_sortie_id_unique" UNIQUE("voie_entree_id","voie_sortie_id")
);
--> statement-breakpoint
ALTER TABLE "voie" DROP CONSTRAINT "voie_branche_id_rang_unique";--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "traversee" geometry(LineString, 4326);--> statement-breakpoint
ALTER TABLE "voie" ADD COLUMN "sens" "sens_voie" NOT NULL;--> statement-breakpoint
ALTER TABLE "voie" ADD COLUMN "geom" geometry(LineString, 4326) NOT NULL;--> statement-breakpoint
ALTER TABLE "connexion" ADD CONSTRAINT "connexion_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connexion" ADD CONSTRAINT "connexion_voie_entree_id_voie_id_fk" FOREIGN KEY ("voie_entree_id") REFERENCES "public"."voie"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connexion" ADD CONSTRAINT "connexion_voie_sortie_id_voie_id_fk" FOREIGN KEY ("voie_sortie_id") REFERENCES "public"."voie"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voie" ADD CONSTRAINT "voie_branche_id_sens_rang_unique" UNIQUE("branche_id","sens","rang");