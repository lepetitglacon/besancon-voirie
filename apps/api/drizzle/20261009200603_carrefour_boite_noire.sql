ALTER TABLE "carrefour" ADD COLUMN "connexions_saisies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "connexion" DROP COLUMN "trace";