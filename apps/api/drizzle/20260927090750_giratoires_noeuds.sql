ALTER TABLE "branche" ADD COLUMN "noeud" text;--> statement-breakpoint
ALTER TABLE "branche" ADD COLUMN "troncon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ligne_feux" DROP COLUMN "anneau";--> statement-breakpoint
-- Les anneaux circulaires (centre, rayon) sont remplacés par des nœuds : à redessiner.
UPDATE "carrefour" SET "anneau" = NULL;