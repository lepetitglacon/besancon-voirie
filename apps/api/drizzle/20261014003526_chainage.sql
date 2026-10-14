CREATE TABLE "chainage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrefour_id" uuid NOT NULL,
	"voie_sortie_id" uuid NOT NULL,
	"voie_entree_id" uuid NOT NULL,
	CONSTRAINT "chainage_voie_sortie_id_voie_entree_id_unique" UNIQUE("voie_sortie_id","voie_entree_id")
);
--> statement-breakpoint
ALTER TABLE "chainage" ADD CONSTRAINT "chainage_carrefour_id_carrefour_id_fk" FOREIGN KEY ("carrefour_id") REFERENCES "public"."carrefour"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chainage" ADD CONSTRAINT "chainage_voie_sortie_id_voie_id_fk" FOREIGN KEY ("voie_sortie_id") REFERENCES "public"."voie"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chainage" ADD CONSTRAINT "chainage_voie_entree_id_voie_id_fk" FOREIGN KEY ("voie_entree_id") REFERENCES "public"."voie"("id") ON DELETE cascade ON UPDATE no action;